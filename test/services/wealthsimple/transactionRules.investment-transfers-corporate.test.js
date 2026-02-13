/**
 * Tests for Wealthsimple Transaction Rules Engine - Investment Transfer & Corporate Action Rules
 *
 * Covers: INVESTMENT_REFUND_TRANSACTION_RULES, INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
 * formatCorporateActionNotes, INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES
 */

import {
  INVESTMENT_REFUND_TRANSACTION_RULES,
  INVESTMENT_INSTITUTIONAL_TRANSFER_RULES,
  INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES,
  formatCorporateActionNotes,
} from '../../../src/services/wealthsimple/transactionRules';

describe('Wealthsimple Transaction Rules Engine - Investment Transfers & Corporate Actions', () => {
  describe('INVESTMENT_REFUND_TRANSACTION_RULES', () => {
    describe('REFUND rule matching', () => {
      it('should match transactions with type REFUND', () => {
        const transaction = {
          externalCanonicalId: 'refund-123',
          type: 'REFUND',
          subType: 'TRANSFER_FEE_REFUND',
          assetSymbol: 'VFV',
          amount: 10.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match REFUND with any subType', () => {
        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');

        expect(rule.match({ type: 'REFUND', subType: 'TRANSFER_FEE_REFUND' })).toBe(true);
        expect(rule.match({ type: 'REFUND', subType: 'FEE_REFUND' })).toBe(true);
        expect(rule.match({ type: 'REFUND', subType: null })).toBe(true);
        expect(rule.match({ type: 'REFUND', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');

        expect(rule.match({ type: 'DEPOSIT', subType: 'REFUND' })).toBe(false);
        expect(rule.match({ type: 'DIVIDEND', subType: 'TRANSFER_FEE_REFUND' })).toBe(false);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(false);
      });
    });

    describe('REFUND transaction processing with subType', () => {
      it('should process REFUND with subType TRANSFER_FEE_REFUND correctly', () => {
        const transaction = {
          externalCanonicalId: 'refund-transfer-fee',
          type: 'REFUND',
          subType: 'TRANSFER_FEE_REFUND',
          assetSymbol: 'VFV',
          amount: 15.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Transfer fee refund');
        expect(result.originalStatement).toBe('REFUND:TRANSFER_FEE_REFUND:VFV');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process REFUND with subType FEE_REFUND correctly', () => {
        const transaction = {
          externalCanonicalId: 'refund-fee',
          type: 'REFUND',
          subType: 'FEE_REFUND',
          assetSymbol: 'XAW',
          amount: 5.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Fee refund');
        expect(result.originalStatement).toBe('REFUND:FEE_REFUND:XAW');
      });

      it('should process REFUND with subType ACCOUNT_FEE_REFUND correctly', () => {
        const transaction = {
          externalCanonicalId: 'refund-account-fee',
          type: 'REFUND',
          subType: 'ACCOUNT_FEE_REFUND',
          assetSymbol: '',
          amount: 25.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Account fee refund');
        expect(result.originalStatement).toBe('REFUND:ACCOUNT_FEE_REFUND:');
      });
    });

    describe('REFUND transaction processing without subType', () => {
      it('should process REFUND with null subType using "Refund" as merchant', () => {
        const transaction = {
          externalCanonicalId: 'refund-null-subtype',
          type: 'REFUND',
          subType: null,
          assetSymbol: 'AAPL',
          amount: 10.0,
          currency: 'USD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Refund');
        expect(result.originalStatement).toBe('REFUND::AAPL');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process REFUND with undefined subType using "Refund" as merchant', () => {
        const transaction = {
          externalCanonicalId: 'refund-undef-subtype',
          type: 'REFUND',
          assetSymbol: 'MSFT',
          amount: 8.0,
          currency: 'USD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Refund');
        expect(result.originalStatement).toBe('REFUND::MSFT');
      });

      it('should process REFUND with empty string subType using "Refund" as merchant', () => {
        const transaction = {
          externalCanonicalId: 'refund-empty-subtype',
          type: 'REFUND',
          subType: '',
          assetSymbol: 'VFV',
          amount: 12.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Refund');
        expect(result.originalStatement).toBe('REFUND::VFV');
      });
    });

    describe('REFUND edge cases', () => {
      it('should handle missing assetSymbol with empty string', () => {
        const transaction = {
          externalCanonicalId: 'refund-no-symbol',
          type: 'REFUND',
          subType: 'TRANSFER_FEE_REFUND',
          assetSymbol: null,
          amount: 5.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Transfer fee refund');
        expect(result.originalStatement).toBe('REFUND:TRANSFER_FEE_REFUND:');
      });

      it('should handle undefined assetSymbol with empty string', () => {
        const transaction = {
          externalCanonicalId: 'refund-undef-symbol',
          type: 'REFUND',
          subType: 'FEE_REFUND',
          amount: 3.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('REFUND:FEE_REFUND:');
      });

      it('should handle all fields missing with appropriate fallbacks', () => {
        const transaction = {
          externalCanonicalId: 'refund-all-missing',
          type: 'REFUND',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Refund');
        expect(result.originalStatement).toBe('REFUND::');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'refund-no-mapping',
          type: 'REFUND',
          subType: 'TRANSFER_FEE_REFUND',
          assetSymbol: 'VFV',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'refund-notes',
          type: 'REFUND',
          subType: 'TRANSFER_FEE_REFUND',
          assetSymbol: 'VFV',
        };

        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_REFUND_TRANSACTION_RULES.find((r) => r.id === 'refund');

        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.description).toBe('string');
        expect(typeof rule.match).toBe('function');
        expect(typeof rule.process).toBe('function');
      });

      it('should have exactly 1 rule', () => {
        expect(INVESTMENT_REFUND_TRANSACTION_RULES.length).toBe(1);
      });

      it('should have unique rule ID', () => {
        const ids = INVESTMENT_REFUND_TRANSACTION_RULES.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });
    });
  });

  describe('INVESTMENT_INSTITUTIONAL_TRANSFER_RULES', () => {
    describe('INSTITUTIONAL_TRANSFER_INTENT rule matching', () => {
      it('should match transactions with type INSTITUTIONAL_TRANSFER_INTENT', () => {
        const transaction = {
          externalCanonicalId: 'institutional-123',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_IN',
          institutionName: 'TD Bank',
          amount: 50000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match INSTITUTIONAL_TRANSFER_INTENT with any subType', () => {
        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');

        expect(rule.match({ type: 'INSTITUTIONAL_TRANSFER_INTENT', subType: 'TRANSFER_IN' })).toBe(true);
        expect(rule.match({ type: 'INSTITUTIONAL_TRANSFER_INTENT', subType: 'TRANSFER_OUT' })).toBe(true);
        expect(rule.match({ type: 'INSTITUTIONAL_TRANSFER_INTENT', subType: 'OTHER_TYPE' })).toBe(true);
        expect(rule.match({ type: 'INSTITUTIONAL_TRANSFER_INTENT', subType: null })).toBe(true);
        expect(rule.match({ type: 'INSTITUTIONAL_TRANSFER_INTENT', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');

        expect(rule.match({ type: 'INTERNAL_TRANSFER', subType: 'SOURCE' })).toBe(false);
        expect(rule.match({ type: 'DEPOSIT', subType: 'TRANSFER_IN' })).toBe(false);
        expect(rule.match({ type: 'WITHDRAWAL', subType: 'TRANSFER_OUT' })).toBe(false);
        expect(rule.match({ type: 'DIVIDEND', subType: null })).toBe(false);
      });
    });

    describe('TRANSFER_IN subType processing', () => {
      it('should process TRANSFER_IN with institution name correctly', () => {
        const transaction = {
          externalCanonicalId: 'institutional-in-123',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_IN',
          institutionName: 'TD Bank',
          amount: 50000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer In from TD Bank');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:TRANSFER_IN:TD Bank');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should handle missing institution name with Unknown Institution fallback for TRANSFER_IN', () => {
        const transaction = {
          externalCanonicalId: 'institutional-in-no-name',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_IN',
          institutionName: null,
          amount: 25000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer In from Unknown Institution');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:TRANSFER_IN:Unknown Institution');
      });

      it('should handle empty string institution name with Unknown Institution fallback for TRANSFER_IN', () => {
        const transaction = {
          externalCanonicalId: 'institutional-in-empty-name',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_IN',
          institutionName: '',
          amount: 10000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer In from Unknown Institution');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:TRANSFER_IN:Unknown Institution');
      });
    });

    describe('TRANSFER_OUT subType processing', () => {
      it('should process TRANSFER_OUT with institution name correctly', () => {
        const transaction = {
          externalCanonicalId: 'institutional-out-123',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_OUT',
          institutionName: 'RBC Royal Bank',
          amount: 75000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer Out to RBC Royal Bank');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:TRANSFER_OUT:RBC Royal Bank');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should handle missing institution name with Unknown Institution fallback for TRANSFER_OUT', () => {
        const transaction = {
          externalCanonicalId: 'institutional-out-no-name',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_OUT',
          institutionName: null,
          amount: 30000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer Out to Unknown Institution');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:TRANSFER_OUT:Unknown Institution');
      });

      it('should handle empty string institution name with Unknown Institution fallback for TRANSFER_OUT', () => {
        const transaction = {
          externalCanonicalId: 'institutional-out-empty-name',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_OUT',
          institutionName: '',
          amount: 15000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer Out to Unknown Institution');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:TRANSFER_OUT:Unknown Institution');
      });
    });

    describe('Other subType processing (fallback)', () => {
      it('should process other subTypes with sentenceCase formatting', () => {
        const transaction = {
          externalCanonicalId: 'institutional-other-123',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'PARTIAL_TRANSFER',
          institutionName: 'BMO',
          amount: 20000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Partial transfer BMO');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:PARTIAL_TRANSFER:BMO');
      });

      it('should handle complex subTypes with underscores using sentenceCase', () => {
        const transaction = {
          externalCanonicalId: 'institutional-complex-subtype',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'IN_KIND_TRANSFER',
          institutionName: 'Questrade',
          amount: 100000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('In kind transfer Questrade');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:IN_KIND_TRANSFER:Questrade');
      });

      it('should handle missing institution name for other subTypes', () => {
        const transaction = {
          externalCanonicalId: 'institutional-other-no-name',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'PARTIAL_TRANSFER',
          institutionName: null,
          amount: 5000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Partial transfer Unknown Institution');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT:PARTIAL_TRANSFER:Unknown Institution');
      });
    });

    describe('Edge cases', () => {
      it('should handle null subType - just show institution name', () => {
        const transaction = {
          externalCanonicalId: 'institutional-null-subtype',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: null,
          institutionName: 'CIBC',
          amount: 12000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('CIBC');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT::CIBC');
      });

      it('should handle undefined subType - just show institution name', () => {
        const transaction = {
          externalCanonicalId: 'institutional-undef-subtype',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          institutionName: 'Scotiabank',
          amount: 8000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Scotiabank');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT::Scotiabank');
      });

      it('should handle empty string subType - just show institution name', () => {
        const transaction = {
          externalCanonicalId: 'institutional-empty-subtype',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: '',
          institutionName: 'National Bank',
          amount: 6000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('National Bank');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT::National Bank');
      });

      it('should handle both subType and institutionName missing', () => {
        const transaction = {
          externalCanonicalId: 'institutional-both-missing',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: null,
          institutionName: null,
          amount: 3000,
          currency: 'CAD',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Unknown Institution');
        expect(result.originalStatement).toBe('INSTITUTIONAL_TRANSFER_INTENT::Unknown Institution');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'institutional-no-mapping',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_IN',
          institutionName: 'TD Bank',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'institutional-notes',
          type: 'INSTITUTIONAL_TRANSFER_INTENT',
          subType: 'TRANSFER_OUT',
          institutionName: 'RBC',
        };

        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.find((r) => r.id === 'institutional-transfer-intent');

        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.description).toBe('string');
        expect(typeof rule.match).toBe('function');
        expect(typeof rule.process).toBe('function');
      });

      it('should have exactly 1 rule', () => {
        expect(INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.length).toBe(1);
      });

      it('should have unique rule ID', () => {
        const ids = INVESTMENT_INSTITUTIONAL_TRANSFER_RULES.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });
    });
  });

  describe('formatCorporateActionNotes', () => {
    it('should return empty string for null childActivities', () => {
      expect(formatCorporateActionNotes('CONSOLIDATION', null)).toBe('');
    });

    it('should return empty string for empty childActivities array', () => {
      expect(formatCorporateActionNotes('CONSOLIDATION', [])).toBe('');
    });

    it('should format consolidation notes correctly (submit > receive)', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: '2100.000000',
          assetSymbol: 'PSNY',
          assetName: 'Polestar Automotive Holding UK Limited',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '70.000000',
          assetSymbol: 'PSNY',
          assetName: 'Polestar Automotive Holding UK PLC',
        },
      ];

      const result = formatCorporateActionNotes('CONSOLIDATION', childActivities);

      expect(result).toContain('Polestar Automotive Holding UK Limited (PSNY) performed a consolidation');
      expect(result).toContain('Every 30 shares of PSNY you held were replaced by 1 share of Polestar Automotive Holding UK PLC (PSNY)');
      expect(result).toContain(' - Remove 2100 PSNY (Polestar Automotive Holding UK Limited)');
      expect(result).toContain(' - Receive 70 PSNY (Polestar Automotive Holding UK PLC)');
    });

    it('should format stock split notes correctly (receive > submit)', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: '100.000000',
          assetSymbol: 'TEST',
          assetName: 'Test Stock Original',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '400.000000',
          assetSymbol: 'TEST',
          assetName: 'Test Stock New',
        },
      ];

      const result = formatCorporateActionNotes('STOCK_SPLIT', childActivities);

      expect(result).toContain('Test Stock Original (TEST) performed a stock split');
      expect(result).toContain('Every share of TEST you held was replaced by 4 shares of Test Stock New (TEST)');
      expect(result).toContain(' - Remove 100 TEST (Test Stock Original)');
      expect(result).toContain(' - Receive 400 TEST (Test Stock New)');
    });

    it('should handle subType with underscores correctly', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: '1000.000000',
          assetSymbol: 'ABC',
          assetName: 'ABC Corp Original',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '100.000000',
          assetSymbol: 'ABC',
          assetName: 'ABC Corp New',
        },
      ];

      const result = formatCorporateActionNotes('REVERSE_STOCK_SPLIT', childActivities);

      expect(result).toContain('performed a reverse stock split');
    });

    it('should handle null subType with "corporate action" fallback', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: '500.000000',
          assetSymbol: 'XYZ',
          assetName: 'XYZ Company',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '50.000000',
          assetSymbol: 'XYZ',
          assetName: 'XYZ Company New',
        },
      ];

      const result = formatCorporateActionNotes(null, childActivities);

      expect(result).toContain('performed a corporate action');
    });

    it('should handle undefined subType with "corporate action" fallback', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: '200.000000',
          assetSymbol: 'DEF',
          assetName: 'DEF Inc',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '20.000000',
          assetSymbol: 'DEF',
          assetName: 'DEF Inc New',
        },
      ];

      const result = formatCorporateActionNotes(undefined, childActivities);

      expect(result).toContain('performed a corporate action');
    });

    it('should only show detail lines when no SUBMIT or RECEIVE activities', () => {
      const childActivities = [
        {
          entitlementType: 'OTHER',
          quantity: '100.000000',
          assetSymbol: 'GHI',
          assetName: 'GHI Corp',
        },
      ];

      const result = formatCorporateActionNotes('MERGER', childActivities);

      // Should only have detail line, no main description (unknown type passes through)
      expect(result).toBe(' - OTHER 100 GHI (GHI Corp)');
      expect(result).not.toContain('performed a');
    });

    it('should handle quantity as string correctly', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: '1500.500000',
          assetSymbol: 'JKL',
          assetName: 'JKL Stock',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '150.050000',
          assetSymbol: 'JKL',
          assetName: 'JKL Stock New',
        },
      ];

      const result = formatCorporateActionNotes('CONSOLIDATION', childActivities);

      expect(result).toContain(' - Remove 1500.5 JKL (JKL Stock)');
      expect(result).toContain(' - Receive 150.05 JKL (JKL Stock New)');
    });

    it('should handle missing quantity with 0 fallback', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: null,
          assetSymbol: 'MNO',
          assetName: 'MNO Corp',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '100.000000',
          assetSymbol: 'MNO',
          assetName: 'MNO Corp New',
        },
      ];

      const result = formatCorporateActionNotes('CONSOLIDATION', childActivities);

      expect(result).toContain(' - Remove 0 MNO (MNO Corp)');
    });

    it('should trim trailing zeros from ratio', () => {
      const childActivities = [
        {
          entitlementType: 'SUBMIT',
          quantity: '100.000000',
          assetSymbol: 'PQR',
          assetName: 'PQR Stock',
        },
        {
          entitlementType: 'RECEIVE',
          quantity: '200.000000',
          assetSymbol: 'PQR',
          assetName: 'PQR Stock New',
        },
      ];

      const result = formatCorporateActionNotes('STOCK_SPLIT', childActivities);

      // Ratio should be 2, not 2.000000
      expect(result).toContain('replaced by 2 shares');
    });
  });

  describe('INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES', () => {
    describe('CORPORATE_ACTION rule matching', () => {
      it('should match transactions with type CORPORATE_ACTION', () => {
        const transaction = {
          canonicalId: 'US7311052010:2025-12-09:H10739748CAD',
          type: 'CORPORATE_ACTION',
          subType: 'CONSOLIDATION',
          assetSymbol: 'PSNY',
          amount: null,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match CORPORATE_ACTION with any subType', () => {
        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');

        expect(rule.match({ type: 'CORPORATE_ACTION', subType: 'CONSOLIDATION' })).toBe(true);
        expect(rule.match({ type: 'CORPORATE_ACTION', subType: 'STOCK_SPLIT' })).toBe(true);
        expect(rule.match({ type: 'CORPORATE_ACTION', subType: 'MERGER' })).toBe(true);
        expect(rule.match({ type: 'CORPORATE_ACTION', subType: null })).toBe(true);
        expect(rule.match({ type: 'CORPORATE_ACTION', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');

        expect(rule.match({ type: 'DIVIDEND', subType: 'CONSOLIDATION' })).toBe(false);
        expect(rule.match({ type: 'DIY_BUY', subType: 'STOCK_SPLIT' })).toBe(false);
        expect(rule.match({ type: 'REFUND', subType: null })).toBe(false);
      });
    });

    describe('CORPORATE_ACTION transaction processing with subType', () => {
      it('should process CORPORATE_ACTION with subType CONSOLIDATION correctly', () => {
        const transaction = {
          canonicalId: 'US7311052010:2025-12-09:H10739748CAD',
          type: 'CORPORATE_ACTION',
          subType: 'CONSOLIDATION',
          assetSymbol: 'PSNY',
          amount: null,
        };

        const childActivities = [
          {
            entitlementType: 'SUBMIT',
            quantity: '2100.000000',
            assetSymbol: 'PSNY',
            assetName: 'Polestar Automotive Holding UK Limited',
          },
          {
            entitlementType: 'RECEIVE',
            quantity: '70.000000',
            assetSymbol: 'PSNY',
            assetName: 'Polestar Automotive Holding UK PLC',
          },
        ];

        const enrichmentMap = new Map();
        enrichmentMap.set('US7311052010:2025-12-09:H10739748CAD', childActivities);

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, enrichmentMap);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('Corporate Action: PSNY Consolidation');
        expect(result.originalStatement).toBe('CORPORATE_ACTION:CONSOLIDATION:PSNY');
        expect(result.notes).toContain('Polestar Automotive Holding UK Limited (PSNY) performed a consolidation');
        expect(result.notes).toContain(' - Remove 2100 PSNY');
        expect(result.notes).toContain(' - Receive 70 PSNY');
        expect(result.technicalDetails).toBe('');
      });

      it('should process CORPORATE_ACTION with subType STOCK_SPLIT correctly', () => {
        const transaction = {
          canonicalId: 'test-split-123',
          type: 'CORPORATE_ACTION',
          subType: 'STOCK_SPLIT',
          assetSymbol: 'NVDA',
          amount: 0,
        };

        const childActivities = [
          {
            entitlementType: 'SUBMIT',
            quantity: '10.000000',
            assetSymbol: 'NVDA',
            assetName: 'NVIDIA Corporation',
          },
          {
            entitlementType: 'RECEIVE',
            quantity: '100.000000',
            assetSymbol: 'NVDA',
            assetName: 'NVIDIA Corporation',
          },
        ];

        const enrichmentMap = new Map();
        enrichmentMap.set('test-split-123', childActivities);

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, enrichmentMap);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('Corporate Action: NVDA Stock split');
        expect(result.originalStatement).toBe('CORPORATE_ACTION:STOCK_SPLIT:NVDA');
        expect(result.notes).toContain('Every share of NVDA you held was replaced by 10 shares');
      });
    });

    describe('CORPORATE_ACTION transaction processing without subType', () => {
      it('should process CORPORATE_ACTION with null subType correctly', () => {
        const transaction = {
          canonicalId: 'test-null-subtype',
          type: 'CORPORATE_ACTION',
          subType: null,
          assetSymbol: 'ABC',
          amount: 0,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Investment');
        expect(result.merchant).toBe('Corporate Action: ABC');
        expect(result.originalStatement).toBe('CORPORATE_ACTION::ABC');
        expect(result.notes).toBe('');
      });

      it('should process CORPORATE_ACTION with undefined subType correctly', () => {
        const transaction = {
          canonicalId: 'test-undef-subtype',
          type: 'CORPORATE_ACTION',
          assetSymbol: 'XYZ',
          amount: 0,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, new Map());

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Corporate Action: XYZ');
        expect(result.originalStatement).toBe('CORPORATE_ACTION::XYZ');
      });

      it('should process CORPORATE_ACTION with empty string subType correctly', () => {
        const transaction = {
          canonicalId: 'test-empty-subtype',
          type: 'CORPORATE_ACTION',
          subType: '',
          assetSymbol: 'DEF',
          amount: 0,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Corporate Action: DEF');
        expect(result.originalStatement).toBe('CORPORATE_ACTION::DEF');
      });
    });

    describe('CORPORATE_ACTION edge cases', () => {
      it('should handle missing assetSymbol with Unknown fallback', () => {
        const transaction = {
          canonicalId: 'test-no-symbol',
          type: 'CORPORATE_ACTION',
          subType: 'MERGER',
          assetSymbol: null,
          amount: 0,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Corporate Action: Unknown Merger');
        expect(result.originalStatement).toBe('CORPORATE_ACTION:MERGER:Unknown');
      });

      it('should handle undefined assetSymbol with Unknown fallback', () => {
        const transaction = {
          canonicalId: 'test-undef-symbol',
          type: 'CORPORATE_ACTION',
          subType: 'CONSOLIDATION',
          amount: 0,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, new Map());

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Corporate Action: Unknown Consolidation');
        expect(result.originalStatement).toBe('CORPORATE_ACTION:CONSOLIDATION:Unknown');
      });

      it('should handle empty string assetSymbol with Unknown fallback', () => {
        const transaction = {
          canonicalId: 'test-empty-symbol',
          type: 'CORPORATE_ACTION',
          subType: 'STOCK_SPLIT',
          assetSymbol: '',
          amount: 0,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Corporate Action: Unknown Stock split');
        expect(result.originalStatement).toBe('CORPORATE_ACTION:STOCK_SPLIT:Unknown');
      });

      it('should handle missing enrichment map', () => {
        const transaction = {
          canonicalId: 'test-no-enrichment',
          type: 'CORPORATE_ACTION',
          subType: 'CONSOLIDATION',
          assetSymbol: 'GHI',
          amount: 0,
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
      });

      it('should handle canonicalId not in enrichment map', () => {
        const transaction = {
          canonicalId: 'test-not-found',
          type: 'CORPORATE_ACTION',
          subType: 'MERGER',
          assetSymbol: 'JKL',
          amount: 0,
        };

        const enrichmentMap = new Map();
        enrichmentMap.set('different-id', [{ entitlementType: 'SUBMIT', quantity: '100' }]);

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, enrichmentMap);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          canonicalId: 'test-no-mapping',
          type: 'CORPORATE_ACTION',
          subType: 'CONSOLIDATION',
          assetSymbol: 'MNO',
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty technicalDetails', () => {
        const transaction = {
          canonicalId: 'test-tech-details',
          type: 'CORPORATE_ACTION',
          subType: 'STOCK_SPLIT',
          assetSymbol: 'PQR',
        };

        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');
        const result = rule.process(transaction, null);

        expect(result).not.toBeNull();
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.find((r) => r.id === 'corporate-action');

        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('description');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.description).toBe('string');
        expect(typeof rule.match).toBe('function');
        expect(typeof rule.process).toBe('function');
      });

      it('should have exactly 1 rule', () => {
        expect(INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.length).toBe(1);
      });

      it('should have unique rule ID', () => {
        const ids = INVESTMENT_CORPORATE_ACTION_TRANSACTION_RULES.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });
    });
  });
});
