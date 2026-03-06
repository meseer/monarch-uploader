/**
 * Tests for Wealthsimple Transaction Rules Engine - Cash E-Transfer Rules
 *
 * Covers: E_TRANSFER rule, applyTransactionRule, hasRuleForTransaction,
 * SPEND/PREPAID rule, DEPOSIT/AFT rule, WITHDRAWAL/AFT rule, rule structure,
 * extractInteracMemo, E_TRANSFER with funding intent/outgoing transfer details,
 * extractOutgoingETransferDetails, formatOutgoingETransferDetails
 */

import {
  CASH_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
  extractStatusSummaryAnnotation,
  extractInteracMemo,
  extractOutgoingETransferDetails,
  formatOutgoingETransferDetails,
} from '../../../src/services/wealthsimple/transactionRules';

describe('Wealthsimple Transaction Rules Engine - Cash E-Transfer', () => {
  describe('E_TRANSFER rule', () => {
    it('should match transactions with subType E_TRANSFER', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'e-transfer');
      expect(rule.match(transaction)).toBe(true);
    });

    it('should not match transactions with different subType', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'DEPOSIT',
        subType: 'INTERNAL_TRANSFER',
        eTransferName: 'John Doe',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'e-transfer');
      expect(rule.match(transaction)).toBe(false);
    });

    describe('DEPOSIT transactions', () => {
      it('should process incoming e-transfer with name and email', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          eTransferName: 'John Doe',
          eTransferEmail: 'john@example.com',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('e-transfer');
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('e-Transfer from John Doe');
        expect(result.originalStatement).toBe('DEPOSIT:E_TRANSFER:Interac e-Transfer from John Doe (john@example.com)');
      });

      it('should fall back to email when name is missing', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          eTransferName: null,
          eTransferEmail: 'john@example.com',
        };

        const result = applyTransactionRule(transaction);

        expect(result.merchant).toBe('e-Transfer from john@example.com');
        expect(result.originalStatement).toBe('DEPOSIT:E_TRANSFER:Interac e-Transfer from john@example.com (john@example.com)');
      });

      it('should fall back to Unknown when both name and email are missing', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          eTransferName: null,
          eTransferEmail: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result.merchant).toBe('e-Transfer from Unknown');
        expect(result.originalStatement).toBe('DEPOSIT:E_TRANSFER:Interac e-Transfer from Unknown');
      });

      it('should handle empty string name by falling back to email', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          eTransferName: '',
          eTransferEmail: 'john@example.com',
        };

        const result = applyTransactionRule(transaction);

        expect(result.merchant).toBe('e-Transfer from john@example.com');
      });

      it('should omit email from original statement when email is null', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
          eTransferName: 'John Doe',
          eTransferEmail: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result.originalStatement).toBe('DEPOSIT:E_TRANSFER:Interac e-Transfer from John Doe');
      });
    });

    describe('WITHDRAWAL transactions', () => {
      it('should process outgoing e-transfer with name and email', () => {
        const transaction = {
          externalCanonicalId: 'tx-456',
          type: 'WITHDRAWAL',
          subType: 'E_TRANSFER',
          eTransferName: 'Jane Smith',
          eTransferEmail: 'jane@example.com',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('e-transfer');
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('e-Transfer to Jane Smith');
        expect(result.originalStatement).toBe('WITHDRAWAL:E_TRANSFER:Interac e-Transfer to Jane Smith (jane@example.com)');
      });

      it('should fall back to email when name is missing', () => {
        const transaction = {
          externalCanonicalId: 'tx-456',
          type: 'WITHDRAWAL',
          subType: 'E_TRANSFER',
          eTransferName: null,
          eTransferEmail: 'jane@example.com',
        };

        const result = applyTransactionRule(transaction);

        expect(result.merchant).toBe('e-Transfer to jane@example.com');
        expect(result.originalStatement).toBe('WITHDRAWAL:E_TRANSFER:Interac e-Transfer to jane@example.com (jane@example.com)');
      });

      it('should fall back to Unknown when both name and email are missing', () => {
        const transaction = {
          externalCanonicalId: 'tx-456',
          type: 'WITHDRAWAL',
          subType: 'E_TRANSFER',
          eTransferName: null,
          eTransferEmail: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result.merchant).toBe('e-Transfer to Unknown');
        expect(result.originalStatement).toBe('WITHDRAWAL:E_TRANSFER:Interac e-Transfer to Unknown');
      });

      it('should omit email from original statement when email is empty', () => {
        const transaction = {
          externalCanonicalId: 'tx-456',
          type: 'WITHDRAWAL',
          subType: 'E_TRANSFER',
          eTransferName: 'Jane Smith',
          eTransferEmail: '',
        };

        const result = applyTransactionRule(transaction);

        expect(result.originalStatement).toBe('WITHDRAWAL:E_TRANSFER:Interac e-Transfer to Jane Smith');
      });
    });

    describe('other transaction types', () => {
      it('should treat non-WITHDRAWAL types as incoming (DEPOSIT-like)', () => {
        const transaction = {
          externalCanonicalId: 'tx-789',
          type: 'SOME_OTHER_TYPE', // Not WITHDRAWAL, not DEPOSIT
          subType: 'E_TRANSFER',
          eTransferName: 'Bob',
          eTransferEmail: 'bob@example.com',
        };

        const result = applyTransactionRule(transaction);

        // Non-WITHDRAWAL types should be treated as incoming
        expect(result.merchant).toBe('e-Transfer from Bob');
        expect(result.originalStatement).toBe('SOME_OTHER_TYPE:E_TRANSFER:Interac e-Transfer from Bob (bob@example.com)');
      });
    });
  });

  describe('applyTransactionRule', () => {
    it('should return null for transactions with no matching rule', () => {
      const transaction = {
        externalCanonicalId: 'tx-999',
        type: 'FEE',
        subType: 'SERVICE_FEE', // No rule for this yet
      };

      const result = applyTransactionRule(transaction);

      expect(result).toBeNull();
    });

    it('should include ruleId in the result', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'Test',
        eTransferEmail: 'test@example.com',
      };

      const result = applyTransactionRule(transaction);

      expect(result.ruleId).toBe('e-transfer');
    });
  });

  describe('hasRuleForTransaction', () => {
    it('should return true for E_TRANSFER subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'E_TRANSFER')).toBe(true);
      expect(hasRuleForTransaction('WITHDRAWAL', 'E_TRANSFER')).toBe(true);
    });

    it('should return true for SPEND/PREPAID type/subType', () => {
      expect(hasRuleForTransaction('SPEND', 'PREPAID')).toBe(true);
    });

    it('should return false for SPEND with wrong subType', () => {
      expect(hasRuleForTransaction('SPEND', 'CARD')).toBe(false);
    });

    it('should return false for PREPAID with wrong type', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'PREPAID')).toBe(false);
    });

    it('should return false for unsupported subTypes', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'INTERNAL_TRANSFER')).toBe(false);
      expect(hasRuleForTransaction('FEE', 'SERVICE_FEE')).toBe(false);
    });

    it('should return false for undefined subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', undefined)).toBe(false);
    });
  });

  describe('SPEND/PREPAID rule', () => {
    it('should match transactions with type SPEND and subType PREPAID', () => {
      const transaction = {
        externalCanonicalId: 'spend-123',
        type: 'SPEND',
        subType: 'PREPAID',
        spendMerchant: 'Test Merchant',
        status: 'settled',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'spend-prepaid');
      expect(rule.match(transaction)).toBe(true);
    });

    it('should not match transactions with different type', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'DEPOSIT',
        subType: 'PREPAID',
        spendMerchant: 'Test Merchant',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'spend-prepaid');
      expect(rule.match(transaction)).toBe(false);
    });

    it('should not match transactions with different subType', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'SPEND',
        subType: 'CARD',
        spendMerchant: 'Test Merchant',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'spend-prepaid');
      expect(rule.match(transaction)).toBe(false);
    });

    describe('transaction processing', () => {
      it('should process SPEND/PREPAID transaction with merchant name', () => {
        const transaction = {
          externalCanonicalId: 'spend-456',
          type: 'SPEND',
          subType: 'PREPAID',
          spendMerchant: 'STARBUCKS #1234',
          status: 'settled',
          amount: 5.99,
          amountSign: 'negative',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('spend-prepaid');
        expect(result.category).toBeNull(); // Needs category mapping
        expect(result.originalStatement).toBe('SPEND:PREPAID:STARBUCKS #1234');
        expect(result.merchant).toBe('Starbucks'); // Cleaned (store number stripped)
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('Starbucks');
      });

      it('should handle missing spendMerchant with fallback to Unknown Merchant', () => {
        const transaction = {
          externalCanonicalId: 'spend-789',
          type: 'SPEND',
          subType: 'PREPAID',
          spendMerchant: null,
          status: 'settled',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('SPEND:PREPAID:Unknown Merchant');
        expect(result.merchant).toBe('Unknown Merchant');
      });

      it('should handle empty spendMerchant with fallback', () => {
        const transaction = {
          externalCanonicalId: 'spend-000',
          type: 'SPEND',
          subType: 'PREPAID',
          spendMerchant: '',
          status: 'settled',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('SPEND:PREPAID:Unknown Merchant');
      });

      it('should strip store numbers from merchant name', () => {
        const transaction = {
          externalCanonicalId: 'spend-store-num',
          type: 'SPEND',
          subType: 'PREPAID',
          spendMerchant: 'LONDON DRUGS 02',
          status: 'settled',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('SPEND:PREPAID:LONDON DRUGS 02');
        expect(result.merchant).toBe('London Drugs');
      });

      it('should clean up merchant prefixes', () => {
        const transaction = {
          externalCanonicalId: 'spend-prefix',
          type: 'SPEND',
          subType: 'PREPAID',
          spendMerchant: 'SQ *COFFEE SHOP',
          status: 'settled',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('SPEND:PREPAID:SQ *COFFEE SHOP');
        expect(result.merchant).toBe('Coffee Shop');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'spend-notes',
          type: 'SPEND',
          subType: 'PREPAID',
          spendMerchant: 'Test Store',
          status: 'settled',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should set categoryKey to cleaned merchant name', () => {
        const transaction = {
          externalCanonicalId: 'spend-catkey',
          type: 'SPEND',
          subType: 'PREPAID',
          spendMerchant: 'NESTERS MARKET 4556',
          status: 'settled',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.categoryKey).toBe('Nesters Market');
      });
    });
  });

  describe('DEPOSIT/AFT rule', () => {
    it('should match transactions with type DEPOSIT and subType AFT', () => {
      const transaction = {
        externalCanonicalId: 'aft-123',
        type: 'DEPOSIT',
        subType: 'AFT',
        aftOriginatorName: 'ACME Corp',
        aftTransactionType: 'payroll_deposit',
        aftTransactionCategory: 'payroll',
        unifiedStatus: 'COMPLETED',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'deposit-aft');
      expect(rule.match(transaction)).toBe(true);
    });

    it('should not match transactions with different type', () => {
      const transaction = {
        externalCanonicalId: 'aft-123',
        type: 'WITHDRAWAL',
        subType: 'AFT',
        aftOriginatorName: 'ACME Corp',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'deposit-aft');
      expect(rule.match(transaction)).toBe(false);
    });

    it('should not match transactions with different subType', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        aftOriginatorName: 'ACME Corp',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'deposit-aft');
      expect(rule.match(transaction)).toBe(false);
    });

    describe('known AFT types - auto-categorization', () => {
      it('should auto-categorize payroll_deposit as Paychecks', () => {
        const transaction = {
          externalCanonicalId: 'aft-payroll-123',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'EMPLOYER INC',
          aftTransactionType: 'payroll_deposit',
          aftTransactionCategory: 'payroll',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBe('Paychecks');
        expect(result.merchant).toBe('Employer Inc');
        // originalStatement preserves the raw originator name (not transformed)
        expect(result.originalStatement).toBe('DEPOSIT:AFT:payroll:payroll_deposit:EMPLOYER INC');
        expect(result.needsCategoryMapping).toBe(false);
      });
    });

    describe('AFT types requiring manual categorization', () => {
      it('should require manual categorization for insurance with type:subType:aftType:originator key', () => {
        const transaction = {
          externalCanonicalId: 'aft-insurance-123',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'BLUE CROSS',
          aftTransactionType: 'insurance',
          aftTransactionCategory: 'insurance',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('DEPOSIT:AFT:insurance:BLUE CROSS');
        expect(result.merchant).toBe('Blue Cross');
        expect(result.originalStatement).toBe('DEPOSIT:AFT:insurance:insurance:BLUE CROSS');
        expect(result.aftDetails).toBeDefined();
        expect(result.aftDetails.aftTransactionType).toBe('insurance');
        expect(result.aftDetails.aftOriginatorName).toBe('BLUE CROSS');
      });

      it('should require manual categorization for misc_payments with type:subType:aftType:originator key', () => {
        const transaction = {
          externalCanonicalId: 'aft-misc-123',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'SOME COMPANY',
          aftTransactionType: 'misc_payments',
          aftTransactionCategory: 'misc',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('DEPOSIT:AFT:misc_payments:SOME COMPANY');
        expect(result.merchant).toBe('Some Company');
        expect(result.originalStatement).toBe('DEPOSIT:AFT:misc:misc_payments:SOME COMPANY');
        expect(result.aftDetails).toBeDefined();
        expect(result.aftDetails.aftTransactionType).toBe('misc_payments');
        expect(result.aftDetails.aftOriginatorName).toBe('SOME COMPANY');
      });
    });

    describe('unknown AFT types - needs category mapping', () => {
      it('should flag unknown aftTransactionType for category mapping with type:subType:aftType:originator key', () => {
        const transaction = {
          externalCanonicalId: 'aft-unknown-123',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'GOVERNMENT AGENCY',
          aftTransactionType: 'government_benefit',
          aftTransactionCategory: 'government',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // New format: "type:subType:aftTransactionType:aftOriginatorName"
        expect(result.categoryKey).toBe('DEPOSIT:AFT:government_benefit:GOVERNMENT AGENCY');
        expect(result.merchant).toBe('Government Agency');
        expect(result.originalStatement).toBe('DEPOSIT:AFT:government:government_benefit:GOVERNMENT AGENCY');
      });

      it('should include aftDetails for category selector display', () => {
        const transaction = {
          externalCanonicalId: 'aft-unknown-456',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'CANADA REVENUE AGENCY',
          aftTransactionType: 'tax_refund',
          aftTransactionCategory: 'tax',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.aftDetails).toBeDefined();
        expect(result.aftDetails.aftOriginatorName).toBe('CANADA REVENUE AGENCY');
        expect(result.aftDetails.aftTransactionType).toBe('tax_refund');
        expect(result.aftDetails.aftTransactionCategory).toBe('tax');
        // Also verify categoryKey format
        expect(result.categoryKey).toBe('DEPOSIT:AFT:tax_refund:CANADA REVENUE AGENCY');
      });

      it('should use type:subType:aftType:originator as categoryKey for similarity matching and saving', () => {
        const transaction = {
          externalCanonicalId: 'aft-unknown-789',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'PENSION FUND',
          aftTransactionType: 'pension_income',
          aftTransactionCategory: 'pension',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.categoryKey).toBe('DEPOSIT:AFT:pension_income:PENSION FUND');
      });
    });

    describe('edge cases', () => {
      it('should handle missing aftOriginatorName with fallback', () => {
        const transaction = {
          externalCanonicalId: 'aft-no-originator',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: null,
          aftTransactionType: 'payroll_deposit',
          aftTransactionCategory: 'payroll',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown Aft');
        expect(result.originalStatement).toBe('DEPOSIT:AFT:payroll:payroll_deposit:Unknown AFT');
      });

      it('should handle empty aftOriginatorName with fallback', () => {
        const transaction = {
          externalCanonicalId: 'aft-empty-originator',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: '',
          aftTransactionType: 'payroll_deposit',
          aftTransactionCategory: 'payroll',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown Aft');
        expect(result.originalStatement).toBe('DEPOSIT:AFT:payroll:payroll_deposit:Unknown AFT');
      });

      it('should handle missing aftTransactionType - needs mapping', () => {
        const transaction = {
          externalCanonicalId: 'aft-no-type',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'SOME CORP',
          aftTransactionType: null,
          aftTransactionCategory: 'misc',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // Should fall back to originatorName for categoryKey
        expect(result.categoryKey).toBe('DEPOSIT:AFT::SOME CORP');
      });

      it('should handle empty aftTransactionType - uses empty string in categoryKey', () => {
        const transaction = {
          externalCanonicalId: 'aft-empty-type',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'ANOTHER CORP',
          aftTransactionType: '',
          aftTransactionCategory: '',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // Empty string preserved in format
        expect(result.categoryKey).toBe('DEPOSIT:AFT::ANOTHER CORP');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'aft-notes-check',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'TEST CORP',
          aftTransactionType: 'payroll_deposit',
          aftTransactionCategory: 'payroll',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });
  });

  describe('hasRuleForTransaction with AFT', () => {
    it('should return true for DEPOSIT/AFT type/subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'AFT')).toBe(true);
    });

    it('should return true for WITHDRAWAL/AFT type/subType', () => {
      expect(hasRuleForTransaction('WITHDRAWAL', 'AFT')).toBe(true);
    });
  });

  describe('WITHDRAWAL/AFT rule', () => {
    it('should match transactions with type WITHDRAWAL and subType AFT', () => {
      const transaction = {
        externalCanonicalId: 'aft-withdrawal-123',
        type: 'WITHDRAWAL',
        subType: 'AFT',
        aftOriginatorName: 'CRA',
        aftTransactionType: 'tax_payment',
        aftTransactionCategory: 'government',
        unifiedStatus: 'COMPLETED',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'withdrawal-aft');
      expect(rule.match(transaction)).toBe(true);
    });

    it('should not match transactions with different type', () => {
      const transaction = {
        externalCanonicalId: 'aft-123',
        type: 'DEPOSIT',
        subType: 'AFT',
        aftOriginatorName: 'CRA',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'withdrawal-aft');
      expect(rule.match(transaction)).toBe(false);
    });

    it('should not match transactions with different subType', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        aftOriginatorName: 'CRA',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'withdrawal-aft');
      expect(rule.match(transaction)).toBe(false);
    });

    describe('transaction processing - always needs category mapping', () => {
      it('should always require category mapping (unlike DEPOSIT/AFT which auto-maps payroll)', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-456',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: 'CRA',
          aftTransactionType: 'tax_payment',
          aftTransactionCategory: 'government',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('withdrawal-aft');
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // applyMerchantMapping applies toTitleCase, so "CRA" becomes "Cra"
        expect(result.merchant).toBe('Cra');
        expect(result.originalStatement).toBe('WITHDRAWAL:AFT:government:tax_payment:CRA');
        // New format: "type:subType:aftTransactionType:aftOriginatorName"
        expect(result.categoryKey).toBe('WITHDRAWAL:AFT:tax_payment:CRA');
      });

      it('should use type:subType:aftType:originator as categoryKey (same format as DEPOSIT/AFT)', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-789',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: 'Revenue Quebec',
          aftTransactionType: 'provincial_tax',
          aftTransactionCategory: 'government',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.categoryKey).toBe('WITHDRAWAL:AFT:provincial_tax:Revenue Quebec');
      });

      it('should include aftDetails for category selector display', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-details',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: 'Service Canada',
          aftTransactionType: 'ei_payment',
          aftTransactionCategory: 'government',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.aftDetails).toBeDefined();
        expect(result.aftDetails.aftOriginatorName).toBe('Service Canada');
        expect(result.aftDetails.aftTransactionType).toBe('ei_payment');
        expect(result.aftDetails.aftTransactionCategory).toBe('government');
        // Also verify categoryKey format
        expect(result.categoryKey).toBe('WITHDRAWAL:AFT:ei_payment:Service Canada');
      });

      it('should set merchant and originalStatement to aftOriginatorName', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-merchant',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: 'Bell Canada',
          aftTransactionType: 'utility_payment',
          aftTransactionCategory: 'utilities',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Bell Canada');
        expect(result.originalStatement).toBe('WITHDRAWAL:AFT:utilities:utility_payment:Bell Canada');
      });
    });

    describe('edge cases', () => {
      it('should handle missing aftOriginatorName with fallback', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-no-originator',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: null,
          aftTransactionType: 'misc_payment',
          aftTransactionCategory: 'misc',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        // applyMerchantMapping applies toTitleCase, so "Unknown AFT" becomes "Unknown Aft"
        expect(result.merchant).toBe('Unknown Aft');
        expect(result.originalStatement).toBe('WITHDRAWAL:AFT:misc:misc_payment:Unknown AFT');
        expect(result.aftDetails.aftOriginatorName).toBe('Unknown AFT');
      });

      it('should handle empty aftOriginatorName with fallback', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-empty-originator',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: '',
          aftTransactionType: 'misc_payment',
          aftTransactionCategory: 'misc',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        // applyMerchantMapping applies toTitleCase, so "Unknown AFT" becomes "Unknown Aft"
        expect(result.merchant).toBe('Unknown Aft');
        expect(result.originalStatement).toBe('WITHDRAWAL:AFT:misc:misc_payment:Unknown AFT');
      });

      it('should handle missing aftTransactionType - fall back to originatorName for categoryKey', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-no-type',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: 'Some Corp',
          aftTransactionType: null,
          aftTransactionCategory: 'misc',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // Uses type:subType::originator format (empty aftType)
        expect(result.categoryKey).toBe('WITHDRAWAL:AFT::Some Corp');
      });

      it('should handle empty aftTransactionType - uses empty string in categoryKey', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-empty-type',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: 'Another Corp',
          aftTransactionType: '',
          aftTransactionCategory: '',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // Empty string preserved in format
        expect(result.categoryKey).toBe('WITHDRAWAL:AFT::Another Corp');
      });

      it('should handle all fields missing with appropriate fallbacks', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-all-missing',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: null,
          aftTransactionType: null,
          aftTransactionCategory: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown Aft');
        expect(result.originalStatement).toBe('WITHDRAWAL:AFT:::Unknown AFT');
        expect(result.categoryKey).toBe('WITHDRAWAL:AFT::Unknown AFT');
        expect(result.aftDetails.aftOriginatorName).toBe('Unknown AFT');
        expect(result.aftDetails.aftTransactionType).toBe('');
        expect(result.aftDetails.aftTransactionCategory).toBe('');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'aft-withdrawal-notes-check',
          type: 'WITHDRAWAL',
          subType: 'AFT',
          aftOriginatorName: 'Test Corp',
          aftTransactionType: 'test_payment',
          aftTransactionCategory: 'test',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });
  });

  describe('rule structure', () => {
    it('should have all required properties for each rule', () => {
      CASH_TRANSACTION_RULES.forEach((rule) => {
        expect(rule).toHaveProperty('id');
        expect(rule).toHaveProperty('match');
        expect(rule).toHaveProperty('process');
        expect(typeof rule.id).toBe('string');
        expect(typeof rule.match).toBe('function');
        expect(typeof rule.process).toBe('function');
      });
    });

    it('should have unique rule IDs', () => {
      const ids = CASH_TRANSACTION_RULES.map((r) => r.id);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });
  });

  describe('extractStatusSummaryAnnotation', () => {
    it('should return empty string for null status summary', () => {
      expect(extractStatusSummaryAnnotation(null)).toBe('');
    });

    it('should return empty string for undefined status summary', () => {
      expect(extractStatusSummaryAnnotation(undefined)).toBe('');
    });

    it('should return empty string when annotation is null', () => {
      const statusSummary = {
        id: 'funding_intent-123',
        annotation: null,
        activityFrequency: 'one_time',
      };
      expect(extractStatusSummaryAnnotation(statusSummary)).toBe('');
    });

    it('should return empty string when annotation is empty string', () => {
      const statusSummary = {
        id: 'funding_intent-123',
        annotation: '',
      };
      expect(extractStatusSummaryAnnotation(statusSummary)).toBe('');
    });

    it('should extract annotation from status summary', () => {
      const statusSummary = {
        id: 'funding_intent-XlVAMs38eHXAMyBguEFOdMArAKZ',
        annotation: 'For mom\'s medical screening',
        activityFrequency: 'one_time',
        isCancellable: false,
      };
      expect(extractStatusSummaryAnnotation(statusSummary)).toBe('For mom\'s medical screening');
    });

    it('should return annotation when other fields are missing', () => {
      const statusSummary = {
        annotation: 'Rent payment',
      };
      expect(extractStatusSummaryAnnotation(statusSummary)).toBe('Rent payment');
    });
  });

  describe('extractInteracMemo', () => {
    it('should return empty string for null funding intent', () => {
      expect(extractInteracMemo(null)).toBe('');
    });

    it('should return empty string for undefined funding intent', () => {
      expect(extractInteracMemo(undefined)).toBe('');
    });

    it('should return empty string when no transferMetadata', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        state: 'completed',
        transferMetadata: null,
      };
      expect(extractInteracMemo(fundingIntent)).toBe('');
    });

    it('should extract memo from incoming e-transfer (e_transfer_receive)', () => {
      const fundingIntent = {
        id: 'funding_intent-abc123',
        state: 'completed',
        transactionType: 'e_transfer_receive',
        transferMetadata: {
          memo: 'Payment for groceries',
          paymentType: 'ACCOUNT_ALIAS_PAYMENT',
          recipient_email: 'test@example.com',
          __typename: 'FundingIntentETransferReceiveMetadata',
        },
      };
      expect(extractInteracMemo(fundingIntent)).toBe('Payment for groceries');
    });

    it('should extract message from outgoing e-transfer (e_transfer_send)', () => {
      const fundingIntent = {
        id: 'funding_intent-def456',
        state: 'completed',
        transactionType: 'e_transfer_send',
        transferMetadata: {
          message: 'Rent payment',
          securityAnswer: null,
          __typename: 'FundingIntentETransferTransactionMetadata',
        },
      };
      expect(extractInteracMemo(fundingIntent)).toBe('Rent payment');
    });

    it('should return empty string when transferMetadata has no memo or message', () => {
      const fundingIntent = {
        id: 'funding_intent-xyz',
        state: 'completed',
        transferMetadata: {
          paymentType: 'SOME_TYPE',
        },
      };
      expect(extractInteracMemo(fundingIntent)).toBe('');
    });

    it('should prefer memo over message if both exist', () => {
      const fundingIntent = {
        id: 'funding_intent-both',
        state: 'completed',
        transferMetadata: {
          memo: 'First memo',
          message: 'Second message',
        },
      };
      // memo takes precedence
      expect(extractInteracMemo(fundingIntent)).toBe('First memo');
    });
  });

  describe('E_TRANSFER rule with status summary annotation (primary source)', () => {
    it('should use status summary annotation as primary source for notes', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('status-summary:funding_intent-abc123', {
        id: 'funding_intent-abc123',
        annotation: 'For mom\'s medical screening',
        activityFrequency: 'one_time',
      });

      const result = applyTransactionRule(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('For mom\'s medical screening');
      expect(result.technicalDetails).toBe('');
    });

    it('should prefer status summary annotation over funding intent memo', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const enrichmentMap = new Map();
      // Both sources present  status summary should win
      enrichmentMap.set('status-summary:funding_intent-abc123', {
        annotation: 'Status summary annotation',
      });
      enrichmentMap.set('funding_intent-abc123', {
        id: 'funding_intent-abc123',
        transferMetadata: {
          memo: 'Old funding intent memo',
        },
      });

      const result = applyTransactionRule(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('Status summary annotation');
    });

    it('should fall back to funding intent memo when status summary has no annotation', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const enrichmentMap = new Map();
      // Status summary present but no annotation
      enrichmentMap.set('status-summary:funding_intent-abc123', {
        annotation: null,
      });
      // Funding intent has memo (deprecated path)
      enrichmentMap.set('funding_intent-abc123', {
        id: 'funding_intent-abc123',
        transferMetadata: {
          memo: 'Fallback memo from FundingIntent',
        },
      });

      const result = applyTransactionRule(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('Fallback memo from FundingIntent');
    });

    it('should fall back to funding intent memo when status summary is missing', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const enrichmentMap = new Map();
      // No status summary entry  only FundingIntent data
      enrichmentMap.set('funding_intent-abc123', {
        id: 'funding_intent-abc123',
        transferMetadata: {
          memo: 'Oven for Unit 202 Trinity',
          paymentType: 'ACCOUNT_ALIAS_PAYMENT',
        },
      });

      const result = applyTransactionRule(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('Oven for Unit 202 Trinity');
    });

    it('should use status summary annotation for outgoing e-transfers and still get technical details', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-out789',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        eTransferName: 'Jane Smith',
        eTransferEmail: 'jane@example.com',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('status-summary:funding_intent-out789', {
        annotation: 'Rent for March',
      });
      enrichmentMap.set('funding_intent-out789', {
        id: 'funding_intent-out789',
        transferMetadata: {
          autoDeposit: true,
          networkPaymentRefId: 'REF123',
          memo: 'Old memo',
        },
      });

      const result = applyTransactionRule(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      // Status summary annotation should be used (not old memo)
      expect(result.notes).toBe('Rent for March');
      // Technical details should still come from FundingIntent
      expect(result.technicalDetails).toBe('Auto Deposit: Yes; Reference Number: REF123');
    });

    it('should return empty notes when both sources have no annotation/memo', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-empty',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const enrichmentMap = new Map();
      enrichmentMap.set('status-summary:funding_intent-empty', {
        annotation: null,
      });
      enrichmentMap.set('funding_intent-empty', {
        id: 'funding_intent-empty',
        transferMetadata: {
          paymentType: 'ACCOUNT_ALIAS_PAYMENT',
          // No memo or message
        },
      });

      const result = applyTransactionRule(transaction, enrichmentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
    });
  });

  describe('E_TRANSFER rule with funding intent memo (deprecated fallback)', () => {
    it('should include memo in notes when only fundingIntentMap is provided', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-abc123', {
        id: 'funding_intent-abc123',
        state: 'completed',
        transactionType: 'e_transfer_receive',
        transferMetadata: {
          memo: 'Oven for Unit 202 Trinity',
          paymentType: 'ACCOUNT_ALIAS_PAYMENT',
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('Oven for Unit 202 Trinity');
      expect(result.technicalDetails).toBe(''); // No technical details for incoming
    });

    it('should include message in notes for outgoing e-transfers', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-def456',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        eTransferName: 'Jane Smith',
        eTransferEmail: 'jane@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-def456', {
        id: 'funding_intent-def456',
        state: 'completed',
        transactionType: 'e_transfer_send',
        transferMetadata: {
          message: 'Rent payment for January',
          securityAnswer: null,
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('Rent payment for January');
    });

    it('should return empty notes and technicalDetails when fundingIntentMap is null', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const result = applyTransactionRule(transaction, null);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('');
    });

    it('should return empty notes when transaction ID not in fundingIntentMap', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-notfound',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-different', {
        id: 'funding_intent-different',
        transferMetadata: { memo: 'Some memo' },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('');
    });

    it('should return empty notes when funding intent has no memo/message', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-nomemo',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-nomemo', {
        id: 'funding_intent-nomemo',
        state: 'completed',
        transferMetadata: {
          paymentType: 'ACCOUNT_ALIAS_PAYMENT',
          // No memo or message
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
    });

    it('should return empty notes when externalCanonicalId is missing', () => {
      const transaction = {
        externalCanonicalId: null,
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-abc123', {
        id: 'funding_intent-abc123',
        transferMetadata: { memo: 'Some memo' },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('');
    });

    it('should handle empty fundingIntentMap', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const fundingIntentMap = new Map();

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('');
    });
  });

  describe('extractOutgoingETransferDetails', () => {
    it('should return nulls for null funding intent', () => {
      const result = extractOutgoingETransferDetails(null);
      expect(result).toEqual({ autoDeposit: null, networkPaymentRefId: null });
    });

    it('should return nulls for undefined funding intent', () => {
      const result = extractOutgoingETransferDetails(undefined);
      expect(result).toEqual({ autoDeposit: null, networkPaymentRefId: null });
    });

    it('should return nulls when no transferMetadata', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        state: 'completed',
        transferMetadata: null,
      };
      const result = extractOutgoingETransferDetails(fundingIntent);
      expect(result).toEqual({ autoDeposit: null, networkPaymentRefId: null });
    });

    it('should extract autoDeposit true as Yes', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        transferMetadata: {
          autoDeposit: true,
          networkPaymentRefId: 'CAkJgEwf',
        },
      };
      const result = extractOutgoingETransferDetails(fundingIntent);
      expect(result.autoDeposit).toBe('Yes');
    });

    it('should extract autoDeposit false as No', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        transferMetadata: {
          autoDeposit: false,
          networkPaymentRefId: 'CAkJgEwf',
        },
      };
      const result = extractOutgoingETransferDetails(fundingIntent);
      expect(result.autoDeposit).toBe('No');
    });

    it('should extract networkPaymentRefId', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        transferMetadata: {
          autoDeposit: true,
          networkPaymentRefId: 'C1AnSCH9shHa',
        },
      };
      const result = extractOutgoingETransferDetails(fundingIntent);
      expect(result.networkPaymentRefId).toBe('C1AnSCH9shHa');
    });

    it('should handle missing autoDeposit field', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        transferMetadata: {
          networkPaymentRefId: 'CAkJgEwf',
        },
      };
      const result = extractOutgoingETransferDetails(fundingIntent);
      expect(result.autoDeposit).toBeNull();
      expect(result.networkPaymentRefId).toBe('CAkJgEwf');
    });

    it('should handle missing networkPaymentRefId field', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        transferMetadata: {
          autoDeposit: false,
        },
      };
      const result = extractOutgoingETransferDetails(fundingIntent);
      expect(result.autoDeposit).toBe('No');
      expect(result.networkPaymentRefId).toBeNull();
    });

    it('should extract both fields from complete transferMetadata', () => {
      const fundingIntent = {
        id: 'funding_intent-123',
        state: 'completed',
        transactionType: 'e_transfer_send',
        transferMetadata: {
          autoDeposit: true,
          securityQuestion: null,
          securityAnswer: null,
          recipientIdentifier: 'test@example.com',
          networkPaymentRefId: 'C1AnSCH9shHa',
          memo: 'Line Honeybadger Skis',
          __typename: 'FundingIntentETransferTransactionMetadata',
        },
      };
      const result = extractOutgoingETransferDetails(fundingIntent);
      expect(result).toEqual({
        autoDeposit: 'Yes',
        networkPaymentRefId: 'C1AnSCH9shHa',
      });
    });
  });

  describe('formatOutgoingETransferDetails', () => {
    it('should return empty string for null details', () => {
      expect(formatOutgoingETransferDetails(null)).toBe('');
    });

    it('should return empty string for undefined details', () => {
      expect(formatOutgoingETransferDetails(undefined)).toBe('');
    });

    it('should format both autoDeposit and networkPaymentRefId', () => {
      const details = {
        autoDeposit: 'No',
        networkPaymentRefId: 'CAkJgEwf',
      };
      expect(formatOutgoingETransferDetails(details)).toBe('Auto Deposit: No; Reference Number: CAkJgEwf');
    });

    it('should format only autoDeposit when networkPaymentRefId is null', () => {
      const details = {
        autoDeposit: 'Yes',
        networkPaymentRefId: null,
      };
      expect(formatOutgoingETransferDetails(details)).toBe('Auto Deposit: Yes');
    });

    it('should format only networkPaymentRefId when autoDeposit is null', () => {
      const details = {
        autoDeposit: null,
        networkPaymentRefId: 'C1AnSCH9shHa',
      };
      expect(formatOutgoingETransferDetails(details)).toBe('Reference Number: C1AnSCH9shHa');
    });

    it('should return empty string when both are null', () => {
      const details = {
        autoDeposit: null,
        networkPaymentRefId: null,
      };
      expect(formatOutgoingETransferDetails(details)).toBe('');
    });
  });

  describe('E_TRANSFER rule with outgoing transfer details', () => {
    it('should include auto-deposit and reference number in technicalDetails for outgoing e-transfer', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-out123',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        eTransferName: 'Jane Smith',
        eTransferEmail: 'jane@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-out123', {
        id: 'funding_intent-out123',
        state: 'completed',
        transactionType: 'e_transfer_send',
        transferMetadata: {
          autoDeposit: false,
          networkPaymentRefId: 'CAkJgEwf',
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('Auto Deposit: No; Reference Number: CAkJgEwf');
    });

    it('should have memo in notes and transfer details in technicalDetails for outgoing e-transfer', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-out456',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        eTransferName: 'Jane Smith',
        eTransferEmail: 'jane@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-out456', {
        id: 'funding_intent-out456',
        state: 'completed',
        transactionType: 'e_transfer_send',
        transferMetadata: {
          autoDeposit: true,
          networkPaymentRefId: 'C1AnSCH9shHa',
          memo: 'Line Honeybadger Skis',
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      // Memo should be in notes, technical details separate
      expect(result.notes).toBe('Line Honeybadger Skis');
      expect(result.technicalDetails).toBe('Auto Deposit: Yes; Reference Number: C1AnSCH9shHa');
    });

    it('should NOT include transfer details for incoming e-transfer', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-in123',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        eTransferName: 'John Doe',
        eTransferEmail: 'john@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-in123', {
        id: 'funding_intent-in123',
        state: 'completed',
        transactionType: 'e_transfer_receive',
        transferMetadata: {
          memo: 'Payment for groceries',
          // These fields exist but should NOT be included for incoming transfers
          autoDeposit: true,
          networkPaymentRefId: 'SomeRefId',
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      // Only memo should be present in notes, no technical details
      expect(result.notes).toBe('Payment for groceries');
      expect(result.technicalDetails).toBe('');
    });

    it('should handle outgoing e-transfer with partial details (only autoDeposit)', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-partial1',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        eTransferName: 'Jane Smith',
        eTransferEmail: 'jane@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-partial1', {
        id: 'funding_intent-partial1',
        state: 'completed',
        transferMetadata: {
          autoDeposit: false,
          // No networkPaymentRefId
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('Auto Deposit: No');
    });

    it('should handle outgoing e-transfer with partial details (only networkPaymentRefId)', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-partial2',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        eTransferName: 'Jane Smith',
        eTransferEmail: 'jane@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-partial2', {
        id: 'funding_intent-partial2',
        state: 'completed',
        transferMetadata: {
          // No autoDeposit
          networkPaymentRefId: 'CAkJgEwf',
        },
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('Reference Number: CAkJgEwf');
    });

    it('should handle outgoing e-transfer with no transferMetadata', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-nodata',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        eTransferName: 'Jane Smith',
        eTransferEmail: 'jane@example.com',
      };

      const fundingIntentMap = new Map();
      fundingIntentMap.set('funding_intent-nodata', {
        id: 'funding_intent-nodata',
        state: 'completed',
        transferMetadata: null,
      });

      const result = applyTransactionRule(transaction, fundingIntentMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
      expect(result.technicalDetails).toBe('');
    });
  });
});
