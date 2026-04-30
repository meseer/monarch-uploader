/**
 * Tests for Wealthsimple Transaction Rules Engine - Investment Dividend & Deposit Rules
 *
 * Covers: INVESTMENT_DIVIDEND_TRANSACTION_RULES, INVESTMENT_DEPOSIT_TRANSACTION_RULES,
 * formatAftOriginalStatement
 */

import {
  INVESTMENT_DIVIDEND_TRANSACTION_RULES,
  INVESTMENT_DEPOSIT_TRANSACTION_RULES,
  formatAftOriginalStatement,
} from '../../../src/services/wealthsimple/transactionRules';

describe('Wealthsimple Transaction Rules Engine - Investment Dividends & Deposits', () => {
  describe('INVESTMENT_DIVIDEND_TRANSACTION_RULES', () => {
    describe('DIVIDEND rule matching', () => {
      it('should match transactions with type DIVIDEND', () => {
        const transaction = {
          externalCanonicalId: 'dividend-123',
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: 10.50,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match DIVIDEND with any subType (null, DIY_DIVIDEND, MANUFACTURED_DIVIDEND)', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');

        expect(rule.match({ type: 'DIVIDEND', subType: null })).toBe(true);
        expect(rule.match({ type: 'DIVIDEND', subType: 'DIY_DIVIDEND' })).toBe(true);
        expect(rule.match({ type: 'DIVIDEND', subType: 'MANUFACTURED_DIVIDEND' })).toBe(true);
        expect(rule.match({ type: 'DIVIDEND', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');

        expect(rule.match({ type: 'DEPOSIT', subType: 'DIVIDEND' })).toBe(false);
        expect(rule.match({ type: 'MANAGED_BUY', subType: null })).toBe(false);
        expect(rule.match({ type: 'DIY_BUY', subType: 'DIY_DIVIDEND' })).toBe(false);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(false);
      });
    });

    describe('DIVIDEND transaction processing - null subType (MANAGED accounts)', () => {
      it('should process DIVIDEND with null subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'dividend-managed-123',
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: 15.75,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('VFV');
        expect(result.originalStatement).toBe('DIVIDEND::VFV');
        expect(result.notes).toBe('Dividend on VFV: CAD$15.75');
        expect(result.technicalDetails).toBe('');
      });

      it('should process DIVIDEND with undefined subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'dividend-managed-456',
          type: 'DIVIDEND',
          assetSymbol: 'XAW',
          amount: 8.25,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('XAW');
        expect(result.originalStatement).toBe('DIVIDEND::XAW');
        expect(result.notes).toBe('Dividend on XAW: CAD$8.25');
      });
    });

    describe('DIVIDEND transaction processing - DIY_DIVIDEND subType (SELF_DIRECTED accounts)', () => {
      it('should process DIVIDEND with DIY_DIVIDEND subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'dividend-diy-123',
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: 'AAPL',
          amount: 25.00,
          currency: 'USD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('AAPL');
        expect(result.originalStatement).toBe('DIVIDEND:DIY_DIVIDEND:AAPL');
        expect(result.notes).toBe('Dividend on AAPL: USD$25');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('DIVIDEND transaction processing - MANUFACTURED_DIVIDEND subType (lended shares)', () => {
      it('should process DIVIDEND with MANUFACTURED_DIVIDEND subType with special notes format', () => {
        const transaction = {
          externalCanonicalId: 'dividend-manufactured-123',
          type: 'DIVIDEND',
          subType: 'MANUFACTURED_DIVIDEND',
          assetSymbol: 'TSLA',
          amount: 12.50,
          currency: 'USD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('TSLA');
        expect(result.originalStatement).toBe('DIVIDEND:MANUFACTURED_DIVIDEND:TSLA');
        expect(result.notes).toBe('Dividend on lended TSLA shares: USD$12.5');
        expect(result.technicalDetails).toBe('');
      });

      it('should use "lended" wording only for MANUFACTURED_DIVIDEND', () => {
        const manufacturedTx = {
          type: 'DIVIDEND',
          subType: 'MANUFACTURED_DIVIDEND',
          assetSymbol: 'GME',
          amount: 5.00,
          currency: 'USD',
        };

        const diyTx = {
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: 'GME',
          amount: 5.00,
          currency: 'USD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');

        const manufacturedResult = rule.process(manufacturedTx);
        const diyResult = rule.process(diyTx);

        expect(manufacturedResult.notes).toContain('lended');
        expect(diyResult.notes).not.toContain('lended');
      });
    });

    describe('DIVIDEND edge cases', () => {
      it('should handle missing assetSymbol with Unknown fallback', () => {
        const transaction = {
          externalCanonicalId: 'dividend-no-symbol',
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: null,
          amount: 10.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown');
        expect(result.originalStatement).toBe('DIVIDEND::Unknown');
        expect(result.notes).toBe('Dividend on Unknown: CAD$10');
      });

      it('should handle empty string assetSymbol with Unknown fallback', () => {
        const transaction = {
          externalCanonicalId: 'dividend-empty-symbol',
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: '',
          amount: 5.00,
          currency: 'USD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown');
        expect(result.originalStatement).toBe('DIVIDEND:DIY_DIVIDEND:Unknown');
        expect(result.notes).toBe('Dividend on Unknown: USD$5');
      });

      it('should handle missing currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'dividend-no-currency',
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: 20.00,
          currency: null,
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Dividend on VFV: CAD$20');
      });

      it('should handle undefined currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'dividend-undefined-currency',
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: 'XAW',
          amount: 15.00,
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Dividend on XAW: CAD$15');
      });

      it('should treat null amount as pending (Upcoming dividend)', () => {
        const transaction = {
          externalCanonicalId: 'dividend-no-amount',
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: null,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        // amount:null means pending (not yet paid out) ’ "Upcoming dividend on {symbol}"
        expect(result.notes).toBe('Upcoming dividend on VFV');
      });

      it('should treat undefined amount as pending (Upcoming dividend)', () => {
        const transaction = {
          externalCanonicalId: 'dividend-undefined-amount',
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: 'AAPL',
          currency: 'USD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        // amount:undefined means pending (not yet paid out) ’ "Upcoming dividend on {symbol}"
        expect(result.notes).toBe('Upcoming dividend on AAPL');
      });

      it('should handle amount of 0 correctly', () => {
        const transaction = {
          externalCanonicalId: 'dividend-zero-amount',
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: 0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Dividend on VFV: CAD$0');
      });

      it('should handle all fields missing with appropriate fallbacks (no amount = pending)', () => {
        const transaction = {
          externalCanonicalId: 'dividend-all-missing',
          type: 'DIVIDEND',
          subType: null,
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('Unknown');
        expect(result.originalStatement).toBe('DIVIDEND::Unknown');
        // No amount field (undefined) ’ treated as pending ’ "Upcoming dividend on Unknown"
        expect(result.notes).toBe('Upcoming dividend on Unknown');
        expect(result.technicalDetails).toBe('');
      });

      it('should handle MANUFACTURED_DIVIDEND with all fields missing (no amount = pending)', () => {
        const transaction = {
          externalCanonicalId: 'dividend-manufactured-missing',
          type: 'DIVIDEND',
          subType: 'MANUFACTURED_DIVIDEND',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('Unknown');
        expect(result.originalStatement).toBe('DIVIDEND:MANUFACTURED_DIVIDEND:Unknown');
        // No amount field (undefined) ’ treated as pending ’ "Upcoming dividend on Unknown"
        expect(result.notes).toBe('Upcoming dividend on Unknown');
      });

      it('should handle decimal amounts correctly', () => {
        const transaction = {
          externalCanonicalId: 'dividend-decimal',
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: 'XEI',
          amount: 0.42,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Dividend on XEI: CAD$0.42');
      });

      it('should handle string amounts by formatting them (removing trailing zeros)', () => {
        const transaction = {
          externalCanonicalId: 'dividend-string-amount',
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: '10.50',
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        // formatAmount removes trailing zeros, so 10.50 becomes 10.5
        expect(result.notes).toBe('Dividend on VFV: CAD$10.5');
      });
    });

    describe('PENDING dividend (unifiedStatus=PENDING, amount=null)', () => {
      // Real-world example: MANAGED_RESP dividend declared but not yet paid out.
      // The API returns amount:null and unifiedStatus:'PENDING' before payable date.
      const pendingDividendTx = {
        externalCanonicalId: 'E002025340589',
        type: 'DIVIDEND',
        subType: 'CASH_DIVIDEND',
        amount: null,
        amountSign: null,
        assetQuantity: '34.3537',
        assetSymbol: 'ZHY',
        canonicalId: 'E002025340589:resp-gjp2y-3a',
        currency: 'CAD',
        status: null,
        unifiedStatus: 'PENDING',
        announcementDate: '2026-02-19',
        recordDate: '2026-02-26',
        payableDate: '2026-03-03',
        grossDividendRate: '0.060000',
        withholdingTaxAmount: '0',
        occurredAt: '2026-02-26T05:00:00.000000+00:00',
      };

      it('should produce "Upcoming dividend on {symbol}" as first notes line when amount is null', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(pendingDividendTx);

        expect(result).not.toBeNull();
        const firstLine = result.notes.split('\n')[0];
        expect(firstLine).toBe('Upcoming dividend on ZHY');
      });

      it('should still include enhanced details (holdings, rate, dates) for pending dividends', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(pendingDividendTx);

        expect(result.notes).toContain('Expected dividends: CAD$2.06');
        expect(result.notes).toContain('Holdings on record date: 34.3537 shares');
        expect(result.notes).toContain('Gross dividend rate: CAD$0.06 per share');
        expect(result.notes).toContain('Announcement date: Feb 19, 2026');
        expect(result.notes).toContain('Record date: Feb 26, 2026');
        expect(result.notes).toContain('Payable date: Mar 3, 2026');
      });

      it('should include expected dividends line calculated from holdings × rate', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const tx = {
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: null,
          currency: 'CAD',
          assetQuantity: 100,
          grossDividendRate: 0.25,
        };
        const result = rule.process(tx);

        expect(result.notes).toContain('Expected dividends: CAD$25');
      });

      it('should include expected dividends with USD currency', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const tx = {
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: 'AAPL',
          amount: null,
          currency: 'USD',
          assetQuantity: 50,
          grossDividendRate: 0.96,
        };
        const result = rule.process(tx);

        expect(result.notes).toContain('Expected dividends: USD$48');
      });

      it('should NOT include expected dividends when assetQuantity is null', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const tx = {
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: null,
          currency: 'CAD',
          assetQuantity: null,
          grossDividendRate: 0.25,
        };
        const result = rule.process(tx);

        expect(result.notes).not.toContain('Expected dividends');
      });

      it('should NOT include expected dividends when grossDividendRate is null', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const tx = {
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: null,
          currency: 'CAD',
          assetQuantity: 100,
          grossDividendRate: null,
        };
        const result = rule.process(tx);

        expect(result.notes).not.toContain('Expected dividends');
      });

      it('should NOT include expected dividends when both fields are missing', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const tx = {
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: null,
          currency: 'CAD',
        };
        const result = rule.process(tx);

        expect(result.notes).not.toContain('Expected dividends');
      });

      it('should NOT include expected dividends for settled dividends (amount present)', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const tx = {
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'VFV',
          amount: 25,
          currency: 'CAD',
          assetQuantity: 100,
          grossDividendRate: 0.25,
        };
        const result = rule.process(tx);

        expect(result.notes).not.toContain('Expected dividends');
        expect(result.notes).toContain('Dividend on VFV: CAD$25');
      });

      it('should handle string values for assetQuantity and grossDividendRate', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const tx = {
          type: 'DIVIDEND',
          subType: null,
          assetSymbol: 'ZHY',
          amount: null,
          currency: 'CAD',
          assetQuantity: '34.3537',
          grossDividendRate: '0.060000',
        };
        const result = rule.process(tx);

        // 34.3537 * 0.06 = 2.061222
        expect(result.notes).toContain('Expected dividends: CAD$2.06');
      });

      it('should NOT include withholding tax line when withholdingTaxAmount is 0', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(pendingDividendTx);

        expect(result.notes).not.toContain('Withholding tax');
      });

      it('should set correct category and merchant for pending dividend', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(pendingDividendTx);

        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('ZHY');
        expect(result.originalStatement).toBe('DIVIDEND:CASH_DIVIDEND:ZHY');
      });

      it('should produce "Upcoming dividend on {symbol}" for any null amount regardless of subType', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');

        const nullSubType = rule.process({ type: 'DIVIDEND', subType: null, assetSymbol: 'VFV', amount: null, currency: 'CAD' });
        const diySubType = rule.process({ type: 'DIVIDEND', subType: 'DIY_DIVIDEND', assetSymbol: 'AAPL', amount: null, currency: 'USD' });
        const manufacturedSubType = rule.process({ type: 'DIVIDEND', subType: 'MANUFACTURED_DIVIDEND', assetSymbol: 'GME', amount: null, currency: 'CAD' });
        const cashSubType = rule.process({ type: 'DIVIDEND', subType: 'CASH_DIVIDEND', assetSymbol: 'ZHY', amount: null, currency: 'CAD' });

        expect(nullSubType.notes.split('\n')[0]).toBe('Upcoming dividend on VFV');
        expect(diySubType.notes.split('\n')[0]).toBe('Upcoming dividend on AAPL');
        expect(manufacturedSubType.notes.split('\n')[0]).toBe('Upcoming dividend on GME');
        expect(cashSubType.notes.split('\n')[0]).toBe('Upcoming dividend on ZHY');
      });

      it('should NOT produce "Upcoming dividend" when amount is 0 (settled with zero payout)', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process({ type: 'DIVIDEND', subType: null, assetSymbol: 'VFV', amount: 0, currency: 'CAD' });

        // amount:0 is a settled transaction (different from null/undefined)
        expect(result.notes.split('\n')[0]).toBe('Dividend on VFV: CAD$0');
      });
    });

    describe('DIVIDEND rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');

        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.description).toBe('string');
        expect(typeof rule.match).toBe('function');
        expect(typeof rule.process).toBe('function');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'dividend-no-mapping',
          type: 'DIVIDEND',
          subType: 'DIY_DIVIDEND',
          assetSymbol: 'VFV',
          amount: 10.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty technicalDetails for all subTypes', () => {
        const rule = INVESTMENT_DIVIDEND_TRANSACTION_RULES.find((r) => r.id === 'dividend');

        const nullResult = rule.process({ type: 'DIVIDEND', subType: null, assetSymbol: 'VFV', amount: 10, currency: 'CAD' });
        const diyResult = rule.process({ type: 'DIVIDEND', subType: 'DIY_DIVIDEND', assetSymbol: 'VFV', amount: 10, currency: 'CAD' });
        const manufacturedResult = rule.process({ type: 'DIVIDEND', subType: 'MANUFACTURED_DIVIDEND', assetSymbol: 'VFV', amount: 10, currency: 'CAD' });

        expect(nullResult.technicalDetails).toBe('');
        expect(diyResult.technicalDetails).toBe('');
        expect(manufacturedResult.technicalDetails).toBe('');
      });
    });
  });

  describe('INVESTMENT_DEPOSIT_TRANSACTION_RULES', () => {
    describe('DEPOSIT rule matching', () => {
      it('should match transactions with type DEPOSIT', () => {
        const transaction = {
          externalCanonicalId: 'deposit-123',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 500,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match DEPOSIT with any subType', () => {
        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');

        expect(rule.match({ type: 'DEPOSIT', subType: 'EFT_RECURRING' })).toBe(true);
        expect(rule.match({ type: 'DEPOSIT', subType: 'EFT' })).toBe(true);
        expect(rule.match({ type: 'DEPOSIT', subType: null })).toBe(true);
        expect(rule.match({ type: 'DEPOSIT', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');

        expect(rule.match({ type: 'WITHDRAWAL', subType: 'EFT_RECURRING' })).toBe(false);
        expect(rule.match({ type: 'DIVIDEND', subType: null })).toBe(false);
        expect(rule.match({ type: 'DIY_BUY', subType: null })).toBe(false);
      });
    });

    describe('DEPOSIT transaction processing with frequency', () => {
      it('should process DEPOSIT with MONTHLY frequency correctly', () => {
        const transaction = {
          externalCanonicalId: 'deposit-monthly-123',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 500,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('Monthly Deposit (CAD)');
        expect(result.originalStatement).toBe('DEPOSIT:EFT_RECURRING:MONTHLY');
        expect(result.notes).toBe('Monthly deposit of CAD$500');
        expect(result.technicalDetails).toBe('');
      });

      it('should process DEPOSIT with WEEKLY frequency correctly', () => {
        const transaction = {
          externalCanonicalId: 'deposit-weekly-123',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'WEEKLY',
          amount: 100,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('Weekly Deposit (CAD)');
        expect(result.originalStatement).toBe('DEPOSIT:EFT_RECURRING:WEEKLY');
        expect(result.notes).toBe('Weekly deposit of CAD$100');
      });

      it('should process DEPOSIT with BIWEEKLY frequency correctly', () => {
        const transaction = {
          externalCanonicalId: 'deposit-biweekly-123',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'BIWEEKLY',
          amount: 250,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Biweekly Deposit (CAD)');
        expect(result.originalStatement).toBe('DEPOSIT:EFT_RECURRING:BIWEEKLY');
        expect(result.notes).toBe('Biweekly deposit of CAD$250');
      });

      it('should handle USD currency', () => {
        const transaction = {
          externalCanonicalId: 'deposit-usd-123',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 1000,
          currency: 'USD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Monthly Deposit (USD)');
        expect(result.notes).toBe('Monthly deposit of USD$1000');
      });
    });

    describe('DEPOSIT transaction processing without frequency', () => {
      it('should process DEPOSIT without frequency (no leading whitespace)', () => {
        const transaction = {
          externalCanonicalId: 'deposit-no-freq-123',
          type: 'DEPOSIT',
          subType: 'EFT',
          frequency: null,
          amount: 500,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('Deposit (CAD)');
        expect(result.originalStatement).toBe('DEPOSIT:EFT:');
        expect(result.notes).toBe('Deposit of CAD$500');
        expect(result.technicalDetails).toBe('');
      });

      it('should process DEPOSIT with empty string frequency (no leading whitespace)', () => {
        const transaction = {
          externalCanonicalId: 'deposit-empty-freq',
          type: 'DEPOSIT',
          subType: 'EFT',
          frequency: '',
          amount: 300,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Deposit (CAD)');
        expect(result.notes).toBe('Deposit of CAD$300');
        // Note: merchant should NOT start with a space
        expect(result.merchant.startsWith(' ')).toBe(false);
        // Note: notes should NOT start with a space
        expect(result.notes.startsWith(' ')).toBe(false);
      });

      it('should process DEPOSIT with undefined frequency (no leading whitespace)', () => {
        const transaction = {
          externalCanonicalId: 'deposit-undef-freq',
          type: 'DEPOSIT',
          subType: 'EFT',
          amount: 400,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Deposit (CAD)');
        expect(result.notes).toBe('Deposit of CAD$400');
      });
    });

    describe('DEPOSIT edge cases', () => {
      it('should handle missing currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'deposit-no-currency',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 500,
          currency: null,
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Monthly Deposit (CAD)');
        expect(result.notes).toBe('Monthly deposit of CAD$500');
      });

      it('should handle undefined currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'deposit-undef-currency',
          type: 'DEPOSIT',
          subType: 'EFT',
          frequency: 'WEEKLY',
          amount: 200,
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Weekly Deposit (CAD)');
        expect(result.notes).toBe('Weekly deposit of CAD$200');
      });

      it('should handle missing amount with 0 fallback', () => {
        const transaction = {
          externalCanonicalId: 'deposit-no-amount',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: null,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Monthly deposit of CAD$0');
      });

      it('should handle undefined amount with 0 fallback', () => {
        const transaction = {
          externalCanonicalId: 'deposit-undef-amount',
          type: 'DEPOSIT',
          subType: 'EFT',
          frequency: 'BIWEEKLY',
          currency: 'USD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Biweekly deposit of USD$0');
      });

      it('should handle amount of 0 correctly', () => {
        const transaction = {
          externalCanonicalId: 'deposit-zero-amount',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Monthly deposit of CAD$0');
      });

      it('should handle missing subType with empty string', () => {
        const transaction = {
          externalCanonicalId: 'deposit-no-subtype',
          type: 'DEPOSIT',
          subType: null,
          frequency: 'MONTHLY',
          amount: 500,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('DEPOSIT::MONTHLY');
      });

      it('should handle all fields missing with appropriate fallbacks', () => {
        const transaction = {
          externalCanonicalId: 'deposit-all-missing',
          type: 'DEPOSIT',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('Deposit (CAD)');
        expect(result.originalStatement).toBe('DEPOSIT::');
        expect(result.notes).toBe('Deposit of CAD$0');
        expect(result.technicalDetails).toBe('');
      });

      it('should handle decimal amounts correctly', () => {
        const transaction = {
          externalCanonicalId: 'deposit-decimal',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 123.45,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('Monthly deposit of CAD$123.45');
      });
    });

    describe('DEPOSIT rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');

        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.description).toBe('string');
        expect(typeof rule.match).toBe('function');
        expect(typeof rule.process).toBe('function');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'deposit-no-mapping',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 500,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'deposit-tech-details',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          frequency: 'MONTHLY',
          amount: 500,
          currency: 'CAD',
        };

        const rule = INVESTMENT_DEPOSIT_TRANSACTION_RULES.find((r) => r.id === 'deposit');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.technicalDetails).toBe('');
      });
    });
  });

  describe('formatAftOriginalStatement', () => {
    it('should format all fields correctly (category before type)', () => {
      const result = formatAftOriginalStatement('DEPOSIT', 'AFT', 'payroll', 'payroll_deposit', 'Employer Inc');
      expect(result).toBe('DEPOSIT:AFT:payroll:payroll_deposit:Employer Inc');
    });

    it('should convert null type to empty string', () => {
      const result = formatAftOriginalStatement(null, 'AFT', 'insurance', 'insurance', 'Blue Cross');
      expect(result).toBe(':AFT:insurance:insurance:Blue Cross');
    });

    it('should convert null subType to empty string', () => {
      const result = formatAftOriginalStatement('DEPOSIT', null, 'insurance', 'insurance', 'Blue Cross');
      expect(result).toBe('DEPOSIT::insurance:insurance:Blue Cross');
    });

    it('should convert null aftTransactionCategory to empty string', () => {
      const result = formatAftOriginalStatement('DEPOSIT', 'AFT', null, 'misc_payments', 'Some Corp');
      expect(result).toBe('DEPOSIT:AFT::misc_payments:Some Corp');
    });

    it('should convert null aftTransactionType to empty string', () => {
      const result = formatAftOriginalStatement('DEPOSIT', 'AFT', 'payroll', null, 'Employer Inc');
      expect(result).toBe('DEPOSIT:AFT:payroll::Employer Inc');
    });

    it('should handle all nulls except statement', () => {
      const result = formatAftOriginalStatement(null, null, null, null, 'Unknown AFT');
      expect(result).toBe('::::Unknown AFT');
    });

    it('should handle undefined values as empty strings', () => {
      const result = formatAftOriginalStatement(undefined, undefined, undefined, undefined, 'Some Statement');
      expect(result).toBe('::::Some Statement');
    });

    it('should handle WITHDRAWAL/AFT format (category before type)', () => {
      const result = formatAftOriginalStatement('WITHDRAWAL', 'AFT', 'government', 'tax_payment', 'CRA');
      expect(result).toBe('WITHDRAWAL:AFT:government:tax_payment:CRA');
    });

    it('should handle empty strings in aftTransactionCategory and aftTransactionType', () => {
      const result = formatAftOriginalStatement('DEPOSIT', 'AFT', '', '', 'Another Corp');
      expect(result).toBe('DEPOSIT:AFT:::Another Corp');
    });
  });
});
