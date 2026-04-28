/**
 * Tests for Questrade Transaction Rules Engine
 */

import {
  cleanString,
  formatNumber,
  formatAmount,
  getTransactionId,
  formatOriginalStatement,
  formatTransactionNotes,
  formatTradeNotes,
  formatFxNotes,
  applyTransactionRule,
  shouldFilterTransaction,
  getTransactionAmount,
  getCurrencyTag,
  getTransactionDate,
  QUESTRADE_TRANSACTION_RULES,
} from '../../../src/services/questrade/transactionRules';

describe('Questrade Transaction Rules', () => {
  describe('cleanString', () => {
    test('returns empty string for null', () => {
      expect(cleanString(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
      expect(cleanString(undefined)).toBe('');
    });

    test('trims whitespace', () => {
      expect(cleanString('  hello  ')).toBe('hello');
    });

    test('converts number to string', () => {
      expect(cleanString(123)).toBe('123');
    });

    test('handles empty string', () => {
      expect(cleanString('')).toBe('');
    });
  });

  describe('formatNumber', () => {
    test('returns empty string for null', () => {
      expect(formatNumber(null)).toBe('');
    });

    test('returns empty string for undefined', () => {
      expect(formatNumber(undefined)).toBe('');
    });

    test('returns empty string for empty string', () => {
      expect(formatNumber('')).toBe('');
    });

    test('removes trailing zeroes', () => {
      expect(formatNumber(100.5000)).toBe('100.5');
    });

    test('removes trailing zeroes after decimal point', () => {
      expect(formatNumber('12.340000')).toBe('12.34');
    });

    test('handles integers', () => {
      expect(formatNumber(100)).toBe('100');
    });

    test('handles negative numbers', () => {
      expect(formatNumber(-50.25)).toBe('-50.25');
    });

    test('returns empty string for non-numeric string', () => {
      expect(formatNumber('abc')).toBe('');
    });
  });

  describe('formatAmount', () => {
    test('returns 0 for null', () => {
      expect(formatAmount(null)).toBe('0');
    });

    test('returns 0 for undefined', () => {
      expect(formatAmount(undefined)).toBe('0');
    });

    test('formats positive amount', () => {
      expect(formatAmount(100.50)).toBe('100.5');
    });

    test('formats negative amount', () => {
      expect(formatAmount(-25.75)).toBe('-25.75');
    });
  });

  describe('getTransactionId', () => {
    test('returns transactionUuid if present', () => {
      const tx = { transactionUuid: 'uuid-123' };
      expect(getTransactionId(tx)).toBe('uuid-123');
    });

    test('generates deterministic ID when transactionUuid is missing', () => {
      const tx = {
        transactionType: 'Dividends',
        action: 'DIV',
        transactionDate: '2025-01-15',
        symbol: 'AAPL',
        net: { amount: 50 },
      };
      const id = getTransactionId(tx);
      expect(id).toContain('generated:');
      expect(id).toContain('Dividends');
      expect(id).toContain('DIV');
    });

    test('handles missing fields in generated ID', () => {
      const tx = {};
      const id = getTransactionId(tx);
      expect(id).toContain('generated:');
    });
  });

  describe('formatOriginalStatement', () => {
    test('formats with all fields', () => {
      expect(formatOriginalStatement('Dividends', 'DIV', 'AAPL')).toBe('Dividends:DIV:AAPL');
    });

    test('formats without symbol - always includes 3 segments', () => {
      expect(formatOriginalStatement('Interest', '')).toBe('Interest::');
    });

    test('handles null values - always includes 3 segments', () => {
      expect(formatOriginalStatement(null, null, null)).toBe('::');
    });

    test('handles null symbol - always includes 3 segments', () => {
      expect(formatOriginalStatement('Deposits', 'DEP', null)).toBe('Deposits:DEP:');
    });
  });

  describe('formatTransactionNotes', () => {
    test('formats notes with description and settlement date (normalized data)', () => {
      const normalized = {
        description: 'Dividend payment',
        transactionDate: '2025-01-15',
        settlementDate: '2025-01-17',
      };
      const notes = formatTransactionNotes(normalized);
      expect(notes).toContain('Dividend payment');
      expect(notes).not.toContain('Transaction Date');
      expect(notes).toContain('Settlement Date: 2025-01-17');
    });

    test('omits settlement date when same as transaction date', () => {
      const normalized = {
        description: 'Test',
        transactionDate: '2025-01-15',
        settlementDate: '2025-01-15',
      };
      const notes = formatTransactionNotes(normalized);
      expect(notes).toContain('Test');
      expect(notes).not.toContain('Transaction Date');
      expect(notes).not.toContain('Settlement Date');
    });

    test('handles minimal normalized data', () => {
      const normalized = {
        description: 'From transaction',
        transactionDate: '2025-01-10',
      };
      const notes = formatTransactionNotes(normalized);
      expect(notes).toContain('From transaction');
      expect(notes).not.toContain('Transaction Date');
    });
  });

  describe('formatFxNotes', () => {
    test('formats FX notes with new API structure (Bought - positive amount)', () => {
      const normalized = {
        description: 'Currency conversion',
        net: {
          currencyCode: 'USD',
          amount: 100.00,
        },
        fx: {
          baseCurrency: {
            currencyCode: 'CAD',
            amount: 135.00,
          },
          averageRate: 0.7407407407,
        },
        transactionDate: '2025-01-15',
        settlementDate: '2025-01-17',
      };
      const notes = formatFxNotes(normalized);
      expect(notes).toContain('Currency conversion');
      expect(notes).toContain('Bought 100 USD @');
      expect(notes).not.toContain('Transaction Date');
      expect(notes).toContain('Settlement Date: 2025-01-17');
    });

    test('formats FX notes with Sold when negative amount', () => {
      const normalized = {
        description: 'Currency conversion',
        net: {
          currencyCode: 'USD',
          amount: -100.00,
        },
        fx: {
          baseCurrency: {
            currencyCode: 'CAD',
            amount: -135.00,
          },
          averageRate: 0.7407407407,
        },
        transactionDate: '2025-01-15',
      };
      const notes = formatFxNotes(normalized);
      expect(notes).toContain('Currency conversion');
      expect(notes).toContain('Sold 100 USD @');
    });

    test('handles missing fx data (normalized data)', () => {
      const normalized = {
        description: 'Test',
        transactionDate: '2025-01-15',
      };
      const notes = formatFxNotes(normalized);
      expect(notes).toContain('Test');
      expect(notes).not.toContain('Bought');
      expect(notes).not.toContain('Sold');
      expect(notes).not.toContain('Transaction Date');
    });
  });

  describe('shouldFilterTransaction', () => {
    test('does not filter trades (they are deduplicated instead)', () => {
      const tx = { transactionType: 'Trades' };
      expect(shouldFilterTransaction(tx)).toBe(false);
    });

    test('does not filter non-trade transactions', () => {
      const tx = { transactionType: 'Dividends' };
      expect(shouldFilterTransaction(tx)).toBe(false);
    });

    test('does not filter deposits', () => {
      const tx = { transactionType: 'Deposits' };
      expect(shouldFilterTransaction(tx)).toBe(false);
    });
  });

  describe('getTransactionAmount', () => {
    test('returns amount from details', () => {
      const details = { net: { amount: 100.50 } };
      expect(getTransactionAmount(details)).toBe(100.5);
    });

    test('returns 0 for null details', () => {
      expect(getTransactionAmount(null)).toBe(0);
    });

    test('returns 0 for missing net', () => {
      expect(getTransactionAmount({})).toBe(0);
    });

    test('returns 0 for null amount', () => {
      expect(getTransactionAmount({ net: { amount: null } })).toBe(0);
    });

    test('handles negative amounts', () => {
      const details = { net: { amount: -50.25 } };
      expect(getTransactionAmount(details)).toBe(-50.25);
    });
  });

  describe('getCurrencyTag', () => {
    test('returns empty string for CAD', () => {
      const details = { net: { currencyCode: 'CAD' } };
      expect(getCurrencyTag(details)).toBe('');
    });

    test('returns USD for USD transactions', () => {
      const details = { net: { currencyCode: 'USD' } };
      expect(getCurrencyTag(details)).toBe('USD');
    });

    test('returns empty string for null details', () => {
      expect(getCurrencyTag(null)).toBe('');
    });

    test('returns empty string for missing currencyCode', () => {
      expect(getCurrencyTag({ net: {} })).toBe('');
    });
  });

  describe('getTransactionDate', () => {
    test('returns date from details', () => {
      const tx = { transactionDate: '2025-01-10' };
      const details = { transactionDate: '2025-01-15' };
      expect(getTransactionDate(tx, details)).toBe('2025-01-15');
    });

    test('falls back to transaction date', () => {
      const tx = { transactionDate: '2025-01-10' };
      expect(getTransactionDate(tx, null)).toBe('2025-01-10');
    });

    test('extracts date from ISO datetime', () => {
      const tx = { transactionDate: '2025-01-15T12:00:00Z' };
      expect(getTransactionDate(tx)).toBe('2025-01-15');
    });

    test('returns empty string for missing date', () => {
      expect(getTransactionDate({}, null)).toBe('');
    });
  });

  describe('Transaction Rule Matching', () => {
    describe('Corporate Actions', () => {
      test('CIL - Cash in Lieu', () => {
        const tx = { transactionType: 'Corporate actions', action: 'CIL', symbol: 'AAPL' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Sell');
        expect(result.merchant).toBe('AAPL');
        expect(result.ruleId).toBe('corporate-actions-cil');
      });

      test('NAC - Name Change', () => {
        const tx = { transactionType: 'Corporate actions', action: 'NAC', symbol: 'XYZ' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('XYZ');
        expect(result.ruleId).toBe('corporate-actions-nac');
      });

      test('REV - Reverse Split', () => {
        const tx = { transactionType: 'Corporate actions', action: 'REV', symbol: 'ABC' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('ABC');
        expect(result.ruleId).toBe('corporate-actions-rev');
      });
    });

    describe('Deposits', () => {
      test('CON - Contribution', () => {
        const tx = { transactionType: 'Deposits', action: 'CON' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer In');
        expect(result.ruleId).toBe('deposits-con');
      });

      test('DEP - Deposit', () => {
        const tx = { transactionType: 'Deposits', action: 'DEP' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Deposit');
        expect(result.ruleId).toBe('deposits-dep');
      });
    });

    describe('Dividend Reinvestment', () => {
      test('REI - Reinvestment', () => {
        const tx = { transactionType: 'Dividend reinvestment', action: 'REI', symbol: 'VFV' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Buy');
        expect(result.merchant).toBe('VFV');
        expect(result.ruleId).toBe('dividend-reinvestment-rei');
      });
    });

    describe('Dividends', () => {
      test('Blank action - Distribution', () => {
        const tx = { transactionType: 'Dividends', action: '', symbol: 'VUN' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('VUN');
        expect(result.ruleId).toBe('dividends-blank');
      });

      test('DIS - Stock Split', () => {
        const tx = { transactionType: 'Dividends', action: 'DIS', symbol: 'TSLA' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('TSLA');
        expect(result.ruleId).toBe('dividends-dis');
      });

      test('DIV - Regular Dividend', () => {
        const tx = { transactionType: 'Dividends', action: 'DIV', symbol: 'MSFT' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('MSFT');
        expect(result.ruleId).toBe('dividends-div');
      });
    });

    describe('FX Conversion', () => {
      test('FXT - Buying USD (positive amount)', () => {
        const tx = { transactionType: 'FX conversion', action: 'FXT' };
        const details = {
          transactionType: 'FX conversion',
          action: 'FXT',
          net: { currencyCode: 'USD', amount: 100.00 },
          fx: {
            baseCurrency: { currencyCode: 'CAD', amount: 135.00 },
            averageRate: 0.7407407407,
          },
        };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Buy');
        expect(result.merchant).toBe('USD'); // non-CAD currency
        expect(result.amountOverride).toBe(135.00); // fx.baseCurrency.amount
        expect(result.currencyOverride).toBe('USD');
        expect(result.ruleId).toBe('fx-conversion-fxt');
      });

      test('FXT - Selling USD (negative amount)', () => {
        const tx = { transactionType: 'FX conversion', action: 'FXT' };
        const details = {
          transactionType: 'FX conversion',
          action: 'FXT',
          net: { currencyCode: 'USD', amount: -100.00 },
          fx: {
            baseCurrency: { currencyCode: 'CAD', amount: -135.00 },
            averageRate: 0.7407407407,
          },
        };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Sell');
        expect(result.merchant).toBe('USD'); // non-CAD currency
        expect(result.amountOverride).toBe(-135.00); // fx.baseCurrency.amount
        expect(result.currencyOverride).toBe('USD');
        expect(result.ruleId).toBe('fx-conversion-fxt');
      });

      test('FXT - CAD currency defaults merchant to Currency Exchange', () => {
        const tx = { transactionType: 'FX conversion', action: 'FXT' };
        const details = {
          transactionType: 'FX conversion',
          action: 'FXT',
          net: { currencyCode: 'CAD', amount: 100.00 },
          fx: {
            baseCurrency: { currencyCode: 'CAD', amount: 135.00 },
            averageRate: 0.7407407407,
          },
        };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Buy');
        expect(result.merchant).toBe('Currency Exchange'); // fallback when CAD
        expect(result.currencyOverride).toBe(''); // empty when CAD
        expect(result.ruleId).toBe('fx-conversion-fxt');
      });

      test('FXT - No details uses fallback merchant', () => {
        const tx = { transactionType: 'FX conversion', action: 'FXT' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Sell'); // 0 is not > 0, so Sell
        expect(result.merchant).toBe('Currency Exchange');
        expect(result.ruleId).toBe('fx-conversion-fxt');
      });
    });

    describe('Fees and Rebates', () => {
      test('FCH - Fee (negative amount)', () => {
        const tx = { transactionType: 'Fees and rebates', action: 'FCH' };
        const details = { net: { amount: -10.00 } };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Fee');
        expect(result.ruleId).toBe('fees-rebates-fch');
      });

      test('FCH - Rebate (positive amount)', () => {
        const tx = { transactionType: 'Fees and rebates', action: 'FCH' };
        const details = { net: { amount: 5.00 } };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Fee Rebate');
        expect(result.ruleId).toBe('fees-rebates-fch');
      });

      test('LFJ - Stock Lending Income', () => {
        const tx = { transactionType: 'Fees and rebates', action: 'LFJ' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Stock Lending');
        expect(result.merchant).toBe('Stock Lending Income');
        expect(result.ruleId).toBe('fees-rebates-lfj');
      });
    });

    describe('Interest', () => {
      test('Interest income (positive amount)', () => {
        const tx = { transactionType: 'Interest', action: '' };
        const details = { net: { amount: 25.00 } };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest');
        expect(result.ruleId).toBe('interest-blank');
      });

      test('Margin interest (negative amount)', () => {
        const tx = { transactionType: 'Interest', action: '' };
        const details = { net: { amount: -15.00 } };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Margin Interest');
        expect(result.ruleId).toBe('interest-blank');
      });
    });

    describe('Other', () => {
      test('BRW - Journalling (Transfer category)', () => {
        const tx = { transactionType: 'Other', action: 'BRW', symbol: 'VFV' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('VFV');
        expect(result.ruleId).toBe('other-brw');
      });

      test('BRW - Journalling with details includes quantity/price', () => {
        const tx = { transactionType: 'Other', action: 'BRW', symbol: 'VFV' };
        const details = {
          transactionType: 'Other',
          action: 'BRW',
          symbol: 'VFV',
          description: 'Transfer between accounts',
          quantity: 100,
          price: { currencyCode: 'CAD', amount: 50.25 },
        };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('VFV');
        expect(result.notes).toContain('Transfer between accounts');
        expect(result.notes).toContain('Quantity: 100');
        expect(result.notes).toContain('Price: 50.25 CAD');
        expect(result.ruleId).toBe('other-brw');
      });

      test('GST - GST on fees', () => {
        const tx = { transactionType: 'Other', action: 'GST' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('GST');
        expect(result.ruleId).toBe('other-gst');
      });

      test('LFJ - Stock Lending Income', () => {
        const tx = { transactionType: 'Other', action: 'LFJ' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Stock Lending');
        expect(result.merchant).toBe('Stock Lending Income');
        expect(result.ruleId).toBe('other-lfj');
      });
    });

    describe('Transfers', () => {
      test('TF6 - Transfer In', () => {
        const tx = { transactionType: 'Transfers', action: 'TF6', symbol: 'VFV' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('VFV');
        expect(result.ruleId).toBe('transfers-tf6');
      });

      test('TFI - Transfer In', () => {
        const tx = { transactionType: 'Transfers', action: 'TFI', symbol: 'AAPL' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('AAPL');
        expect(result.ruleId).toBe('transfers-tfi');
      });

      test('TFO - Transfer Out', () => {
        const tx = { transactionType: 'Transfers', action: 'TFO', symbol: 'GOOG' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('GOOG');
        expect(result.ruleId).toBe('transfers-tfo');
      });

      test('TSF - Internal Transfer', () => {
        const tx = { transactionType: 'Transfers', action: 'TSF' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Internal Transfer');
        expect(result.ruleId).toBe('transfers-tsf');
      });
    });

    describe('Withdrawals', () => {
      test('CON - Contribution withdrawal', () => {
        const tx = { transactionType: 'Withdrawals', action: 'CON' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer Out');
        expect(result.ruleId).toBe('withdrawals-con');
      });

      test('EFT - EFT Withdrawal', () => {
        const tx = { transactionType: 'Withdrawals', action: 'EFT' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Withdrawal');
        expect(result.ruleId).toBe('withdrawals-eft');
      });
    });

    describe('Trades', () => {
      test('Buy - Buy order', () => {
        const tx = { transactionType: 'Trades', action: 'Buy', symbol: 'VGRO.TO' };
        const details = {
          transactionType: 'Trades',
          action: 'Buy',
          symbol: 'VGRO.TO',
          quantity: 4.0,
          price: { currencyCode: 'CAD', amount: 36.3 },
          net: { currencyCode: 'CAD', amount: -145.21 },
          commission: 0.0,
          description: 'VANGUARD GROWTH ETF PORTFOLIO ETF UNIT WE ACTED AS AGENT',
          transactionDate: '2024-10-09',
          settlementDate: '2024-10-11',
        };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Buy');
        expect(result.merchant).toBe('VGRO.TO');
        expect(result.ruleId).toBe('trades-buy');
        expect(result.originalStatement).toBe('Trades:Buy:VGRO.TO');
        expect(result.notes).toContain('VANGUARD GROWTH ETF');
        expect(result.notes).toContain('Filled 4 @ 36.3');
        expect(result.notes).toContain('Total: 145.21 CAD');
        expect(result.notes).toContain('Settlement Date: 2024-10-11');
      });

      test('Sell - Sell order', () => {
        const tx = { transactionType: 'Trades', action: 'Sell', symbol: 'AMZN' };
        const details = {
          transactionType: 'Trades',
          action: 'Sell',
          symbol: 'AMZN',
          quantity: 50.0,
          price: { currencyCode: 'USD', amount: 271.6984 },
          net: { currencyCode: 'USD', amount: 13584.92 },
          commission: 0.0,
          description: 'AMAZON.COM INC WE ACTED AS AGENT',
          transactionDate: '2025-04-23',
          settlementDate: '2025-04-25',
        };
        const result = applyTransactionRule(tx, details);
        expect(result.category).toBe('Sell');
        expect(result.merchant).toBe('AMZN');
        expect(result.ruleId).toBe('trades-sell');
      });

      test('Buy with no details (list data only)', () => {
        const tx = {
          transactionType: 'Trades',
          action: 'Buy',
          symbol: 'AOA',
          quantity: 1.0,
          price: { currencyCode: 'USD', amount: 76.9799 },
          net: { currencyCode: 'USD', amount: -76.98 },
          description: 'ISHARES CORE AGGRESSIVE ALLOCATION FUND ETF WE ACTED AS AGENT',
          transactionDate: '2024-12-30',
        };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Buy');
        expect(result.merchant).toBe('AOA');
        expect(result.ruleId).toBe('trades-buy');
      });

      test('Unknown trade action uses trades-fallback', () => {
        const tx = { transactionType: 'Trades', action: 'Short' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Investment');
        expect(result.ruleId).toBe('trades-fallback');
      });

      test('Trade with no symbol uses Unknown Security', () => {
        const tx = { transactionType: 'Trades', action: 'Buy' };
        const result = applyTransactionRule(tx, null);
        expect(result.merchant).toBe('Unknown Security');
      });
    });

    describe('Fallback', () => {
      test('Unknown transaction type uses fallback', () => {
        const tx = { transactionType: 'Unknown Type', action: 'XYZ' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Uncategorized');
        expect(result.merchant).toBe('Unknown Type - XYZ');
        expect(result.ruleId).toBe('unknown-fallback');
      });

      test('Unknown action uses fallback', () => {
        const tx = { transactionType: 'Dividends', action: 'UNKNOWN' };
        const result = applyTransactionRule(tx, null);
        expect(result.category).toBe('Uncategorized');
        expect(result.merchant).toBe('Dividends - UNKNOWN');
        expect(result.ruleId).toBe('unknown-fallback');
      });
    });
  });

  describe('Rules Array', () => {
    test('has expected number of rules', () => {
      // 22 original rules + 3 trade rules + 1 fallback = 26
      expect(QUESTRADE_TRANSACTION_RULES.length).toBe(26);
    });

    test('all rules have required properties', () => {
      for (const rule of QUESTRADE_TRANSACTION_RULES) {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.description).toBe('string');
        expect(typeof rule.match).toBe('function');
        expect(typeof rule.process).toBe('function');
      }
    });

    test('fallback rule is last', () => {
      const lastRule = QUESTRADE_TRANSACTION_RULES[QUESTRADE_TRANSACTION_RULES.length - 1];
      expect(lastRule.id).toBe('unknown-fallback');
    });
  });
});
