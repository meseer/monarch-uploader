/**
 * Tests for Wealthsimple Transaction Rules Engine
 */

import {
  CASH_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
  extractInteracMemo,
  extractOutgoingETransferDetails,
  formatOutgoingETransferDetails,
  getAccountNameById,
  getAccountNameByType,
  extractInternalTransferAnnotation,
} from '../../../src/services/wealthsimple/transactionRules';
import { STORAGE } from '../../../src/core/config';

describe('Wealthsimple Transaction Rules Engine', () => {
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
        expect(result.originalStatement).toBe('Interac e-Transfer from John Doe (john@example.com)');
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
        expect(result.originalStatement).toBe('Interac e-Transfer from john@example.com (john@example.com)');
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
        expect(result.originalStatement).toBe('Interac e-Transfer from Unknown');
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

        expect(result.originalStatement).toBe('Interac e-Transfer from John Doe');
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
        expect(result.originalStatement).toBe('Interac e-Transfer to Jane Smith (jane@example.com)');
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
        expect(result.originalStatement).toBe('Interac e-Transfer to jane@example.com (jane@example.com)');
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
        expect(result.originalStatement).toBe('Interac e-Transfer to Unknown');
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

        expect(result.originalStatement).toBe('Interac e-Transfer to Jane Smith');
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
        expect(result.originalStatement).toBe('Interac e-Transfer from Bob (bob@example.com)');
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
        expect(result.originalStatement).toBe('STARBUCKS #1234');
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
        expect(result.originalStatement).toBe('Unknown Merchant');
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
        expect(result.originalStatement).toBe('Unknown Merchant');
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
        expect(result.originalStatement).toBe('LONDON DRUGS 02');
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
        expect(result.originalStatement).toBe('SQ *COFFEE SHOP');
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
          aftOriginatorName: 'Employer Inc',
          aftTransactionType: 'payroll_deposit',
          aftTransactionCategory: 'payroll',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBe('Paychecks');
        expect(result.merchant).toBe('Employer Inc');
        expect(result.originalStatement).toBe('Employer Inc');
        expect(result.needsCategoryMapping).toBe(false);
      });
    });

    describe('AFT types requiring manual categorization', () => {
      it('should require manual categorization for insurance with type:subType:aftType:originator key', () => {
        const transaction = {
          externalCanonicalId: 'aft-insurance-123',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'Blue Cross',
          aftTransactionType: 'insurance',
          aftTransactionCategory: 'insurance',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('DEPOSIT:AFT:insurance:Blue Cross');
        expect(result.merchant).toBe('Blue Cross');
        expect(result.originalStatement).toBe('Blue Cross');
        expect(result.aftDetails).toBeDefined();
        expect(result.aftDetails.aftTransactionType).toBe('insurance');
        expect(result.aftDetails.aftOriginatorName).toBe('Blue Cross');
      });

      it('should require manual categorization for misc_payments with type:subType:aftType:originator key', () => {
        const transaction = {
          externalCanonicalId: 'aft-misc-123',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'Some Company',
          aftTransactionType: 'misc_payments',
          aftTransactionCategory: 'misc',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('DEPOSIT:AFT:misc_payments:Some Company');
        expect(result.merchant).toBe('Some Company');
        expect(result.originalStatement).toBe('Some Company');
        expect(result.aftDetails).toBeDefined();
        expect(result.aftDetails.aftTransactionType).toBe('misc_payments');
        expect(result.aftDetails.aftOriginatorName).toBe('Some Company');
      });
    });

    describe('unknown AFT types - needs category mapping', () => {
      it('should flag unknown aftTransactionType for category mapping with type:subType:aftType:originator key', () => {
        const transaction = {
          externalCanonicalId: 'aft-unknown-123',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'Government Agency',
          aftTransactionType: 'government_benefit',
          aftTransactionCategory: 'government',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('deposit-aft');
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // New format: "type:subType:aftTransactionType:aftOriginatorName"
        expect(result.categoryKey).toBe('DEPOSIT:AFT:government_benefit:Government Agency');
        expect(result.merchant).toBe('Government Agency');
        expect(result.originalStatement).toBe('Government Agency');
      });

      it('should include aftDetails for category selector display', () => {
        const transaction = {
          externalCanonicalId: 'aft-unknown-456',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'CRA',
          aftTransactionType: 'tax_refund',
          aftTransactionCategory: 'tax',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.aftDetails).toBeDefined();
        expect(result.aftDetails.aftOriginatorName).toBe('CRA');
        expect(result.aftDetails.aftTransactionType).toBe('tax_refund');
        expect(result.aftDetails.aftTransactionCategory).toBe('tax');
        // Also verify categoryKey format
        expect(result.categoryKey).toBe('DEPOSIT:AFT:tax_refund:CRA');
      });

      it('should use type:subType:aftType:originator as categoryKey for similarity matching and saving', () => {
        const transaction = {
          externalCanonicalId: 'aft-unknown-789',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'Pension Fund',
          aftTransactionType: 'pension_income',
          aftTransactionCategory: 'pension',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.categoryKey).toBe('DEPOSIT:AFT:pension_income:Pension Fund');
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
        expect(result.merchant).toBe('Unknown AFT');
        expect(result.originalStatement).toBe('Unknown AFT');
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
        expect(result.merchant).toBe('Unknown AFT');
        expect(result.originalStatement).toBe('Unknown AFT');
      });

      it('should handle missing aftTransactionType - needs mapping', () => {
        const transaction = {
          externalCanonicalId: 'aft-no-type',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'Some Corp',
          aftTransactionType: null,
          aftTransactionCategory: 'misc',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBeNull();
        expect(result.needsCategoryMapping).toBe(true);
        // Should fall back to originatorName for categoryKey
        expect(result.categoryKey).toBe('DEPOSIT:AFT::Some Corp');
      });

      it('should handle empty aftTransactionType - uses empty string in categoryKey', () => {
        const transaction = {
          externalCanonicalId: 'aft-empty-type',
          type: 'DEPOSIT',
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
        expect(result.categoryKey).toBe('DEPOSIT:AFT::Another Corp');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'aft-notes-check',
          type: 'DEPOSIT',
          subType: 'AFT',
          aftOriginatorName: 'Test Corp',
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
        expect(result.merchant).toBe('CRA');
        expect(result.originalStatement).toBe('CRA');
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
        expect(result.originalStatement).toBe('Bell Canada');
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
        expect(result.merchant).toBe('Unknown AFT');
        expect(result.originalStatement).toBe('Unknown AFT');
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
        expect(result.merchant).toBe('Unknown AFT');
        expect(result.originalStatement).toBe('Unknown AFT');
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
        expect(result.merchant).toBe('Unknown AFT');
        expect(result.originalStatement).toBe('Unknown AFT');
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

  describe('E_TRANSFER rule with funding intent memo', () => {
    it('should include memo in notes when fundingIntentMap is provided', () => {
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

  describe('INTERNAL_TRANSFER rule', () => {
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
      // Set up mock accounts for each test
      setupMockAccounts([
        { id: 'account-cash-123', nickname: 'Wealthsimple Cash (1234)' },
        { id: 'account-tfsa-456', nickname: 'Wealthsimple TFSA (5678)' },
        { id: 'account-rrsp-789', nickname: 'Wealthsimple RRSP (9012)' },
      ]);
    });

    describe('rule matching', () => {
      it('should match transactions with type INTERNAL_TRANSFER and subType SOURCE', () => {
        const transaction = {
          externalCanonicalId: 'transfer-123',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          accountId: 'account-cash-123',
          opposingAccountId: 'account-tfsa-456',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'internal-transfer');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match transactions with type INTERNAL_TRANSFER and subType DESTINATION', () => {
        const transaction = {
          externalCanonicalId: 'transfer-456',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: 'account-tfsa-456',
          opposingAccountId: 'account-cash-123',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'internal-transfer');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match INTERNAL_TRANSFER with different subType', () => {
        const transaction = {
          externalCanonicalId: 'transfer-789',
          type: 'INTERNAL_TRANSFER',
          subType: 'OTHER',
          accountId: 'account-cash-123',
          opposingAccountId: 'account-tfsa-456',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'internal-transfer');
        expect(rule.match(transaction)).toBe(false);
      });

      it('should not match different type with SOURCE subType', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'SOURCE',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'internal-transfer');
        expect(rule.match(transaction)).toBe(false);
      });
    });

    describe('DESTINATION transactions (money coming in)', () => {
      it('should process DESTINATION transfer with correct format', () => {
        const transaction = {
          externalCanonicalId: 'transfer-dest-123',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: 'account-tfsa-456',
          opposingAccountId: 'account-cash-123',
          amount: 500,
          amountSign: 'positive',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('internal-transfer');
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer In: Wealthsimple TFSA (5678) ← Wealthsimple Cash (1234)');
        expect(result.originalStatement).toBe('Transfer In: Wealthsimple TFSA (5678) ← Wealthsimple Cash (1234)');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should show opposing account as source in DESTINATION transfer', () => {
        const transaction = {
          externalCanonicalId: 'transfer-dest-456',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: 'account-rrsp-789',
          opposingAccountId: 'account-cash-123',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        // Format: Transfer In: Destination ← Source
        // Source is opposing (Cash), Destination is current (RRSP)
        expect(result.merchant).toBe('Transfer In: Wealthsimple RRSP (9012) ← Wealthsimple Cash (1234)');
      });
    });

    describe('SOURCE transactions (money going out)', () => {
      it('should process SOURCE transfer with correct format', () => {
        const transaction = {
          externalCanonicalId: 'transfer-src-123',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          accountId: 'account-cash-123',
          opposingAccountId: 'account-tfsa-456',
          amount: 500,
          amountSign: 'negative',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('internal-transfer');
        expect(result.category).toBe('Transfer');
        // Format: Transfer Out: Current → Opposing
        expect(result.merchant).toBe('Transfer Out: Wealthsimple Cash (1234) → Wealthsimple TFSA (5678)');
        expect(result.originalStatement).toBe('Transfer Out: Wealthsimple Cash (1234) → Wealthsimple TFSA (5678)');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should show current account as source in SOURCE transfer', () => {
        const transaction = {
          externalCanonicalId: 'transfer-src-456',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          accountId: 'account-rrsp-789',
          opposingAccountId: 'account-tfsa-456',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        // Format: Transfer Out: Current → Opposing
        // Current is RRSP, Opposing is TFSA
        expect(result.merchant).toBe('Transfer Out: Wealthsimple RRSP (9012) → Wealthsimple TFSA (5678)');
      });
    });

    describe('unknown account handling', () => {
      it('should handle missing opposingAccountId', () => {
        const transaction = {
          externalCanonicalId: 'transfer-no-opposing',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: 'account-cash-123',
          opposingAccountId: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer In: Wealthsimple Cash (1234) ← Unknown Account');
      });

      it('should handle unknown opposingAccountId', () => {
        const transaction = {
          externalCanonicalId: 'transfer-unknown-opposing',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          accountId: 'account-cash-123',
          opposingAccountId: 'account-unknown-999',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer Out: Wealthsimple Cash (1234) → Unknown Account');
      });

      it('should handle missing accountId', () => {
        const transaction = {
          externalCanonicalId: 'transfer-no-current',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: null,
          opposingAccountId: 'account-tfsa-456',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer In: Unknown Account ← Wealthsimple TFSA (5678)');
      });

      it('should handle both accounts unknown', () => {
        const transaction = {
          externalCanonicalId: 'transfer-both-unknown',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          accountId: 'unknown-1',
          opposingAccountId: 'unknown-2',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer Out: Unknown Account → Unknown Account');
      });
    });

    describe('edge cases', () => {
      it('should handle empty accounts list in storage', () => {
        setupMockAccounts([]);

        const transaction = {
          externalCanonicalId: 'transfer-empty-list',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: 'account-cash-123',
          opposingAccountId: 'account-tfsa-456',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Transfer');
        expect(result.merchant).toBe('Transfer In: Unknown Account ← Unknown Account');
      });

      it('should not have needsCategoryMapping flag', () => {
        const transaction = {
          externalCanonicalId: 'transfer-no-mapping',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: 'account-cash-123',
          opposingAccountId: 'account-tfsa-456',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });
    });
  });

  describe('getAccountNameById', () => {
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

    it('should return account nickname when found', () => {
      setupMockAccounts([
        { id: 'test-account-1', nickname: 'My Cash Account' },
      ]);

      const result = getAccountNameById('test-account-1');
      expect(result).toBe('My Cash Account');
    });

    it('should return "Unknown Account" when accountId is null', () => {
      setupMockAccounts([{ id: 'some-account', nickname: 'Some Account' }]);

      const result = getAccountNameById(null);
      expect(result).toBe('Unknown Account');
    });

    it('should return "Unknown Account" when accountId is undefined', () => {
      setupMockAccounts([{ id: 'some-account', nickname: 'Some Account' }]);

      const result = getAccountNameById(undefined);
      expect(result).toBe('Unknown Account');
    });

    it('should return "Unknown Account" when accountId is not found', () => {
      setupMockAccounts([{ id: 'existing-account', nickname: 'Existing Account' }]);

      const result = getAccountNameById('non-existent-account');
      expect(result).toBe('Unknown Account');
    });

    it('should return "Unknown Account" when account has no nickname', () => {
      const consolidatedAccounts = [
        {
          wealthsimpleAccount: {
            id: 'no-nickname-account',
            nickname: null,
          },
        },
      ];
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return JSON.stringify(consolidatedAccounts);
        }
        return defaultValue;
      });

      const result = getAccountNameById('no-nickname-account');
      expect(result).toBe('Unknown Account');
    });

    it('should return "Unknown Account" when storage has invalid JSON', () => {
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return 'invalid-json{';
        }
        return defaultValue;
      });

      const result = getAccountNameById('any-account');
      expect(result).toBe('Unknown Account');
    });

    it('should return "Unknown Account" when storage is empty array', () => {
      setupMockAccounts([]);

      const result = getAccountNameById('any-account');
      expect(result).toBe('Unknown Account');
    });
  });

  describe('hasRuleForTransaction with INTERNAL_TRANSFER', () => {
    it('should return true for INTERNAL_TRANSFER/SOURCE', () => {
      expect(hasRuleForTransaction('INTERNAL_TRANSFER', 'SOURCE')).toBe(true);
    });

    it('should return true for INTERNAL_TRANSFER/DESTINATION', () => {
      expect(hasRuleForTransaction('INTERNAL_TRANSFER', 'DESTINATION')).toBe(true);
    });

    it('should return false for INTERNAL_TRANSFER with wrong subType', () => {
      expect(hasRuleForTransaction('INTERNAL_TRANSFER', 'OTHER')).toBe(false);
    });

    it('should return false for wrong type with SOURCE/DESTINATION subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'SOURCE')).toBe(false);
      expect(hasRuleForTransaction('WITHDRAWAL', 'DESTINATION')).toBe(false);
    });
  });

  describe('WITHDRAWAL/BILL_PAY rule', () => {
    it('should match transactions with type WITHDRAWAL and subType BILL_PAY', () => {
      const transaction = {
        externalCanonicalId: 'bill-123',
        type: 'WITHDRAWAL',
        subType: 'BILL_PAY',
        billPayCompanyName: 'BC Hydro',
        billPayPayeeNickname: 'Home Electricity',
        redactedExternalAccountNumber: '****1234',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'withdrawal-bill-pay');
      expect(rule.match(transaction)).toBe(true);
    });

    it('should not match transactions with different type', () => {
      const transaction = {
        externalCanonicalId: 'bill-123',
        type: 'DEPOSIT',
        subType: 'BILL_PAY',
        billPayCompanyName: 'BC Hydro',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'withdrawal-bill-pay');
      expect(rule.match(transaction)).toBe(false);
    });

    it('should not match transactions with different subType', () => {
      const transaction = {
        externalCanonicalId: 'tx-123',
        type: 'WITHDRAWAL',
        subType: 'E_TRANSFER',
        billPayCompanyName: 'BC Hydro',
      };

      const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'withdrawal-bill-pay');
      expect(rule.match(transaction)).toBe(false);
    });

    describe('transaction processing', () => {
      it('should process bill pay transaction with all fields present', () => {
        const transaction = {
          externalCanonicalId: 'bill-456',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: 'BC Hydro',
          billPayPayeeNickname: 'Home Electricity',
          redactedExternalAccountNumber: '****5678',
          amount: 150.00,
          amountSign: 'negative',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('withdrawal-bill-pay');
        expect(result.category).toBeNull(); // Needs category mapping
        expect(result.merchant).toBe('Home Electricity');
        expect(result.originalStatement).toBe('BC Hydro (****5678)');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('WITHDRAWAL:BILL_PAY:Home Electricity');
      });

      it('should include billPayDetails for category selector display', () => {
        const transaction = {
          externalCanonicalId: 'bill-789',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: 'Rogers Wireless',
          billPayPayeeNickname: 'Cell Phone',
          redactedExternalAccountNumber: '****9012',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.billPayDetails).toBeDefined();
        expect(result.billPayDetails.billPayCompanyName).toBe('Rogers Wireless');
        expect(result.billPayDetails.billPayPayeeNickname).toBe('Cell Phone');
        expect(result.billPayDetails.redactedExternalAccountNumber).toBe('****9012');
      });

      it('should use billPayPayeeNickname as categoryKey', () => {
        const transaction = {
          externalCanonicalId: 'bill-catkey',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: 'Telus',
          billPayPayeeNickname: 'Internet',
          redactedExternalAccountNumber: '****3456',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.categoryKey).toBe('WITHDRAWAL:BILL_PAY:Internet');
      });
    });

    describe('edge cases', () => {
      it('should handle missing billPayCompanyName with fallback', () => {
        const transaction = {
          externalCanonicalId: 'bill-no-company',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: null,
          billPayPayeeNickname: 'Utilities',
          redactedExternalAccountNumber: '****1111',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('Unknown Company (****1111)');
        expect(result.billPayDetails.billPayCompanyName).toBe('Unknown Company');
      });

      it('should handle missing billPayPayeeNickname with fallback', () => {
        const transaction = {
          externalCanonicalId: 'bill-no-nickname',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: 'Shaw Cable',
          billPayPayeeNickname: null,
          redactedExternalAccountNumber: '****2222',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown Payee');
        expect(result.categoryKey).toBe('WITHDRAWAL:BILL_PAY:Unknown Payee');
        expect(result.billPayDetails.billPayPayeeNickname).toBe('Unknown Payee');
      });

      it('should handle missing redactedExternalAccountNumber', () => {
        const transaction = {
          externalCanonicalId: 'bill-no-account',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: 'Enbridge Gas',
          billPayPayeeNickname: 'Gas Bill',
          redactedExternalAccountNumber: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('Enbridge Gas ()');
        expect(result.billPayDetails.redactedExternalAccountNumber).toBe('');
      });

      it('should handle all fields missing with fallbacks', () => {
        const transaction = {
          externalCanonicalId: 'bill-all-missing',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: null,
          billPayPayeeNickname: null,
          redactedExternalAccountNumber: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown Payee');
        expect(result.originalStatement).toBe('Unknown Company ()');
        expect(result.categoryKey).toBe('WITHDRAWAL:BILL_PAY:Unknown Payee');
        expect(result.billPayDetails.billPayCompanyName).toBe('Unknown Company');
        expect(result.billPayDetails.billPayPayeeNickname).toBe('Unknown Payee');
        expect(result.billPayDetails.redactedExternalAccountNumber).toBe('');
      });

      it('should handle empty string billPayCompanyName with fallback', () => {
        const transaction = {
          externalCanonicalId: 'bill-empty-company',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: '',
          billPayPayeeNickname: 'My Bill',
          redactedExternalAccountNumber: '****3333',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('Unknown Company (****3333)');
      });

      it('should handle empty string billPayPayeeNickname with fallback', () => {
        const transaction = {
          externalCanonicalId: 'bill-empty-nickname',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: 'City Water',
          billPayPayeeNickname: '',
          redactedExternalAccountNumber: '****4444',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Unknown Payee');
        expect(result.categoryKey).toBe('WITHDRAWAL:BILL_PAY:Unknown Payee');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'bill-notes-check',
          type: 'WITHDRAWAL',
          subType: 'BILL_PAY',
          billPayCompanyName: 'Insurance Co',
          billPayPayeeNickname: 'Home Insurance',
          redactedExternalAccountNumber: '****5555',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });
  });

  describe('hasRuleForTransaction with BILL_PAY', () => {
    it('should return true for WITHDRAWAL/BILL_PAY type/subType', () => {
      expect(hasRuleForTransaction('WITHDRAWAL', 'BILL_PAY')).toBe(true);
    });

    it('should return false for DEPOSIT/BILL_PAY type/subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'BILL_PAY')).toBe(false);
    });

    it('should return false for BILL_PAY with wrong type', () => {
      expect(hasRuleForTransaction('SPEND', 'BILL_PAY')).toBe(false);
      expect(hasRuleForTransaction('INTERNAL_TRANSFER', 'BILL_PAY')).toBe(false);
    });
  });

  describe('INTEREST rule', () => {
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
      // Set up mock accounts for each test
      setupMockAccounts([
        { id: 'account-cash-123', nickname: 'Wealthsimple Cash (1234)' },
        { id: 'account-cash-usd-456', nickname: 'Wealthsimple Cash USD (5678)' },
      ]);
    });

    describe('rule matching', () => {
      it('should match transactions with type INTEREST (ignoring subType)', () => {
        const transaction = {
          externalCanonicalId: 'interest-123',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: 'account-cash-123',
          amount: 5.42,
          amountSign: 'positive',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'interest');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match INTEREST with any subType', () => {
        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'interest');

        expect(rule.match({ type: 'INTEREST', subType: 'SAVINGS_INTEREST' })).toBe(true);
        expect(rule.match({ type: 'INTEREST', subType: 'PROMO_INTEREST' })).toBe(true);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(true);
        expect(rule.match({ type: 'INTEREST', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'interest');

        expect(rule.match({ type: 'DEPOSIT', subType: 'INTEREST' })).toBe(false);
        expect(rule.match({ type: 'WITHDRAWAL', subType: 'INTEREST' })).toBe(false);
        expect(rule.match({ type: 'SPEND', subType: 'INTEREST' })).toBe(false);
      });
    });

    describe('transaction processing', () => {
      it('should process INTEREST transaction with account name', () => {
        const transaction = {
          externalCanonicalId: 'interest-456',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: 'account-cash-123',
          amount: 12.50,
          amountSign: 'positive',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('interest');
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest: Wealthsimple Cash (1234)');
        expect(result.originalStatement).toBe('Interest: Wealthsimple Cash (1234)');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should handle different account IDs', () => {
        const transaction = {
          externalCanonicalId: 'interest-789',
          type: 'INTEREST',
          subType: 'PROMO_INTEREST',
          accountId: 'account-cash-usd-456',
          amount: 3.75,
          amountSign: 'positive',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest: Wealthsimple Cash USD (5678)');
        expect(result.originalStatement).toBe('Interest: Wealthsimple Cash USD (5678)');
      });

      it('should handle missing accountId with Unknown Account fallback', () => {
        const transaction = {
          externalCanonicalId: 'interest-no-account',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: null,
          amount: 1.00,
          amountSign: 'positive',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest: Unknown Account');
        expect(result.originalStatement).toBe('Interest: Unknown Account');
      });

      it('should handle unknown accountId with Unknown Account fallback', () => {
        const transaction = {
          externalCanonicalId: 'interest-unknown-account',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: 'account-unknown-999',
          amount: 2.00,
          amountSign: 'positive',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest: Unknown Account');
        expect(result.originalStatement).toBe('Interest: Unknown Account');
      });

      it('should not require category mapping', () => {
        const transaction = {
          externalCanonicalId: 'interest-no-mapping',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: 'account-cash-123',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        // INTEREST rule does not set needsCategoryMapping
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'interest-notes-check',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: 'account-cash-123',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('edge cases', () => {
      it('should handle empty accounts list in storage', () => {
        setupMockAccounts([]);

        const transaction = {
          externalCanonicalId: 'interest-empty-list',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: 'account-cash-123',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.merchant).toBe('Interest: Unknown Account');
        expect(result.originalStatement).toBe('Interest: Unknown Account');
      });

      it('should ignore fundingIntentMap (not used for INTEREST)', () => {
        const transaction = {
          externalCanonicalId: 'interest-with-map',
          type: 'INTEREST',
          subType: 'SAVINGS_INTEREST',
          accountId: 'account-cash-123',
        };

        const fundingIntentMap = new Map();
        fundingIntentMap.set('interest-with-map', { memo: 'Some memo' });

        // INTEREST rule doesn't use fundingIntentMap, so result should be the same
        const result = applyTransactionRule(transaction, fundingIntentMap);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Interest');
        expect(result.notes).toBe(''); // memo should NOT be extracted
      });
    });
  });

  describe('hasRuleForTransaction with INTEREST', () => {
    it('should return true for INTEREST type (with any subType)', () => {
      expect(hasRuleForTransaction('INTEREST', 'SAVINGS_INTEREST')).toBe(true);
      expect(hasRuleForTransaction('INTEREST', 'PROMO_INTEREST')).toBe(true);
      expect(hasRuleForTransaction('INTEREST', null)).toBe(true);
      expect(hasRuleForTransaction('INTEREST', undefined)).toBe(true);
    });

    it('should return false for non-INTEREST types with INTEREST-like subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'INTEREST')).toBe(false);
      expect(hasRuleForTransaction('WITHDRAWAL', 'SAVINGS_INTEREST')).toBe(false);
    });
  });

  describe('extractInternalTransferAnnotation', () => {
    it('should return empty string for null internal transfer', () => {
      expect(extractInternalTransferAnnotation(null)).toBe('');
    });

    it('should return empty string for undefined internal transfer', () => {
      expect(extractInternalTransferAnnotation(undefined)).toBe('');
    });

    it('should extract annotation when present', () => {
      const internalTransfer = {
        id: 'funding_intent-abc123',
        annotation: 'additional payment landed in wrong account',
        status: 'completed',
      };
      expect(extractInternalTransferAnnotation(internalTransfer)).toBe('additional payment landed in wrong account');
    });

    it('should return empty string when annotation is null', () => {
      const internalTransfer = {
        id: 'funding_intent-abc123',
        annotation: null,
        status: 'completed',
      };
      expect(extractInternalTransferAnnotation(internalTransfer)).toBe('');
    });

    it('should return empty string when annotation is undefined', () => {
      const internalTransfer = {
        id: 'funding_intent-abc123',
        status: 'completed',
      };
      expect(extractInternalTransferAnnotation(internalTransfer)).toBe('');
    });

    it('should return empty string when annotation is empty string', () => {
      const internalTransfer = {
        id: 'funding_intent-abc123',
        annotation: '',
        status: 'completed',
      };
      expect(extractInternalTransferAnnotation(internalTransfer)).toBe('');
    });
  });

  describe('INTERNAL_TRANSFER rule with annotation', () => {
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
      setupMockAccounts([
        { id: 'account-cash-123', nickname: 'Wealthsimple Cash (1234)' },
        { id: 'account-tfsa-456', nickname: 'Wealthsimple TFSA (5678)' },
      ]);
    });

    it('should include annotation in notes when internalTransferMap is provided', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
      };

      const internalTransferMap = new Map();
      internalTransferMap.set('funding_intent-abc123', {
        id: 'funding_intent-abc123',
        annotation: 'additional payment landed in wrong account',
        status: 'completed',
        transferType: 'partial_in_cash',
      });

      const result = applyTransactionRule(transaction, internalTransferMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('additional payment landed in wrong account');
      expect(result.technicalDetails).toBe('');
    });

    it('should include annotation for SOURCE transfers too', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-def456',
        type: 'INTERNAL_TRANSFER',
        subType: 'SOURCE',
        accountId: 'account-cash-123',
        opposingAccountId: 'account-tfsa-456',
      };

      const internalTransferMap = new Map();
      internalTransferMap.set('funding_intent-def456', {
        id: 'funding_intent-def456',
        annotation: 'moving funds to TFSA',
        status: 'completed',
      });

      const result = applyTransactionRule(transaction, internalTransferMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('moving funds to TFSA');
    });

    it('should return empty notes when internalTransferMap is null', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
      };

      const result = applyTransactionRule(transaction, null);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
    });

    it('should return empty notes when transaction ID not in internalTransferMap', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-notfound',
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
      };

      const internalTransferMap = new Map();
      internalTransferMap.set('funding_intent-different', {
        id: 'funding_intent-different',
        annotation: 'Some annotation',
      });

      const result = applyTransactionRule(transaction, internalTransferMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
    });

    it('should return empty notes when internal transfer has no annotation', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-no-annotation',
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
      };

      const internalTransferMap = new Map();
      internalTransferMap.set('funding_intent-no-annotation', {
        id: 'funding_intent-no-annotation',
        annotation: null,
        status: 'completed',
      });

      const result = applyTransactionRule(transaction, internalTransferMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
    });

    it('should return empty notes when externalCanonicalId is missing', () => {
      const transaction = {
        externalCanonicalId: null,
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
      };

      const internalTransferMap = new Map();
      internalTransferMap.set('funding_intent-abc123', {
        id: 'funding_intent-abc123',
        annotation: 'Some annotation',
      });

      const result = applyTransactionRule(transaction, internalTransferMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
    });

    it('should handle empty internalTransferMap', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
      };

      const internalTransferMap = new Map();

      const result = applyTransactionRule(transaction, internalTransferMap);

      expect(result).not.toBeNull();
      expect(result.notes).toBe('');
    });
  });

  describe('getAccountNameByType', () => {
    const setupMockAccountsWithTypes = (accounts) => {
      const consolidatedAccounts = accounts.map((acc) => ({
        wealthsimpleAccount: {
          id: acc.id,
          nickname: acc.nickname,
          type: acc.type,
        },
      }));
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return JSON.stringify(consolidatedAccounts);
        }
        return defaultValue;
      });
    };

    it('should return account nickname when type is found', () => {
      setupMockAccountsWithTypes([
        { id: 'cc-123', nickname: 'Wealthsimple Credit Card (1234)', type: 'CREDIT_CARD' },
        { id: 'cash-456', nickname: 'Wealthsimple Cash', type: 'CASH' },
      ]);

      const result = getAccountNameByType('CREDIT_CARD');
      expect(result).toBe('Wealthsimple Credit Card (1234)');
    });

    it('should return null when accountType is null', () => {
      setupMockAccountsWithTypes([
        { id: 'cc-123', nickname: 'Credit Card', type: 'CREDIT_CARD' },
      ]);

      const result = getAccountNameByType(null);
      expect(result).toBeNull();
    });

    it('should return null when accountType is undefined', () => {
      setupMockAccountsWithTypes([
        { id: 'cc-123', nickname: 'Credit Card', type: 'CREDIT_CARD' },
      ]);

      const result = getAccountNameByType(undefined);
      expect(result).toBeNull();
    });

    it('should return null when accountType is not found', () => {
      setupMockAccountsWithTypes([
        { id: 'cash-123', nickname: 'Cash Account', type: 'CASH' },
      ]);

      const result = getAccountNameByType('CREDIT_CARD');
      expect(result).toBeNull();
    });

    it('should return null when account has no nickname', () => {
      const consolidatedAccounts = [
        {
          wealthsimpleAccount: {
            id: 'cc-123',
            nickname: null,
            type: 'CREDIT_CARD',
          },
        },
      ];
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return JSON.stringify(consolidatedAccounts);
        }
        return defaultValue;
      });

      const result = getAccountNameByType('CREDIT_CARD');
      expect(result).toBeNull();
    });

    it('should return null when storage has invalid JSON', () => {
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return 'invalid-json{';
        }
        return defaultValue;
      });

      const result = getAccountNameByType('CREDIT_CARD');
      expect(result).toBeNull();
    });

    it('should return null when storage is empty array', () => {
      setupMockAccountsWithTypes([]);

      const result = getAccountNameByType('CREDIT_CARD');
      expect(result).toBeNull();
    });

    it('should return first matching account when multiple accounts have same type', () => {
      setupMockAccountsWithTypes([
        { id: 'cc-123', nickname: 'First Credit Card', type: 'CREDIT_CARD' },
        { id: 'cc-456', nickname: 'Second Credit Card', type: 'CREDIT_CARD' },
      ]);

      const result = getAccountNameByType('CREDIT_CARD');
      expect(result).toBe('First Credit Card');
    });

    it('should find CASH type account', () => {
      setupMockAccountsWithTypes([
        { id: 'cc-123', nickname: 'Credit Card', type: 'CREDIT_CARD' },
        { id: 'cash-456', nickname: 'My Cash Account', type: 'CASH' },
      ]);

      const result = getAccountNameByType('CASH');
      expect(result).toBe('My Cash Account');
    });
  });

  describe('CREDIT_CARD_PAYMENT rule', () => {
    // Helper to set up mock accounts in GM storage
    const setupMockAccountsWithTypes = (accounts) => {
      const consolidatedAccounts = accounts.map((acc) => ({
        wealthsimpleAccount: {
          id: acc.id,
          nickname: acc.nickname,
          type: acc.type,
        },
      }));
      global.GM_getValue = jest.fn((key, defaultValue) => {
        if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
          return JSON.stringify(consolidatedAccounts);
        }
        return defaultValue;
      });
    };

    describe('rule matching', () => {
      it('should match transactions with type CREDIT_CARD_PAYMENT', () => {
        const transaction = {
          externalCanonicalId: 'cc-payment-123',
          type: 'CREDIT_CARD_PAYMENT',
          subType: 'SOME_SUBTYPE',
          amount: 500,
          amountSign: 'negative',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'credit-card-payment');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match CREDIT_CARD_PAYMENT with any subType (ignoring subType)', () => {
        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'credit-card-payment');

        expect(rule.match({ type: 'CREDIT_CARD_PAYMENT', subType: 'SCHEDULED' })).toBe(true);
        expect(rule.match({ type: 'CREDIT_CARD_PAYMENT', subType: 'MANUAL' })).toBe(true);
        expect(rule.match({ type: 'CREDIT_CARD_PAYMENT', subType: null })).toBe(true);
        expect(rule.match({ type: 'CREDIT_CARD_PAYMENT', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'credit-card-payment');

        expect(rule.match({ type: 'WITHDRAWAL', subType: 'CREDIT_CARD_PAYMENT' })).toBe(false);
        expect(rule.match({ type: 'DEPOSIT', subType: 'CREDIT_CARD_PAYMENT' })).toBe(false);
        expect(rule.match({ type: 'SPEND', subType: 'CREDIT_CARD_PAYMENT' })).toBe(false);
      });
    });

    describe('transaction processing', () => {
      it('should process CREDIT_CARD_PAYMENT with credit card account name from storage', () => {
        setupMockAccountsWithTypes([
          { id: 'cash-123', nickname: 'Wealthsimple Cash', type: 'CASH' },
          { id: 'cc-456', nickname: 'Wealthsimple Credit Card (1234)', type: 'CREDIT_CARD' },
        ]);

        const transaction = {
          externalCanonicalId: 'cc-payment-456',
          type: 'CREDIT_CARD_PAYMENT',
          subType: 'SCHEDULED',
          amount: 250.00,
          amountSign: 'negative',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('credit-card-payment');
        expect(result.category).toBe('Credit Card Payment');
        expect(result.merchant).toBe('Wealthsimple Credit Card (1234)');
        expect(result.originalStatement).toBe('Wealthsimple Credit Card (1234)');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should use fallback name when no credit card account exists', () => {
        setupMockAccountsWithTypes([
          { id: 'cash-123', nickname: 'Wealthsimple Cash', type: 'CASH' },
          { id: 'tfsa-456', nickname: 'Wealthsimple TFSA', type: 'MANAGED_TFSA' },
        ]);

        const transaction = {
          externalCanonicalId: 'cc-payment-789',
          type: 'CREDIT_CARD_PAYMENT',
          subType: null,
          amount: 100.00,
          amountSign: 'negative',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('credit-card-payment');
        expect(result.category).toBe('Credit Card Payment');
        expect(result.merchant).toBe('Wealthsimple Credit Card');
        expect(result.originalStatement).toBe('Wealthsimple Credit Card');
      });

      it('should use fallback when accounts list is empty', () => {
        setupMockAccountsWithTypes([]);

        const transaction = {
          externalCanonicalId: 'cc-payment-empty',
          type: 'CREDIT_CARD_PAYMENT',
          subType: 'MANUAL',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Credit Card Payment');
        expect(result.merchant).toBe('Wealthsimple Credit Card');
        expect(result.originalStatement).toBe('Wealthsimple Credit Card');
      });

      it('should use fallback when credit card has no nickname', () => {
        const consolidatedAccounts = [
          {
            wealthsimpleAccount: {
              id: 'cc-123',
              nickname: null,
              type: 'CREDIT_CARD',
            },
          },
        ];
        global.GM_getValue = jest.fn((key, defaultValue) => {
          if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
            return JSON.stringify(consolidatedAccounts);
          }
          return defaultValue;
        });

        const transaction = {
          externalCanonicalId: 'cc-payment-no-nickname',
          type: 'CREDIT_CARD_PAYMENT',
          subType: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Wealthsimple Credit Card');
        expect(result.originalStatement).toBe('Wealthsimple Credit Card');
      });

      it('should not require category mapping', () => {
        setupMockAccountsWithTypes([
          { id: 'cc-123', nickname: 'Credit Card', type: 'CREDIT_CARD' },
        ]);

        const transaction = {
          externalCanonicalId: 'cc-payment-mapping',
          type: 'CREDIT_CARD_PAYMENT',
          subType: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        // CREDIT_CARD_PAYMENT rule does not set needsCategoryMapping
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        setupMockAccountsWithTypes([
          { id: 'cc-123', nickname: 'Credit Card', type: 'CREDIT_CARD' },
        ]);

        const transaction = {
          externalCanonicalId: 'cc-payment-notes-check',
          type: 'CREDIT_CARD_PAYMENT',
          subType: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('edge cases', () => {
      it('should handle invalid JSON in storage', () => {
        global.GM_getValue = jest.fn((key, defaultValue) => {
          if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
            return 'invalid-json{';
          }
          return defaultValue;
        });

        const transaction = {
          externalCanonicalId: 'cc-payment-invalid-json',
          type: 'CREDIT_CARD_PAYMENT',
          subType: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Credit Card Payment');
        expect(result.merchant).toBe('Wealthsimple Credit Card');
        expect(result.originalStatement).toBe('Wealthsimple Credit Card');
      });

      it('should ignore fundingIntentMap (not used for CREDIT_CARD_PAYMENT)', () => {
        setupMockAccountsWithTypes([
          { id: 'cc-123', nickname: 'My Credit Card', type: 'CREDIT_CARD' },
        ]);

        const transaction = {
          externalCanonicalId: 'cc-payment-with-map',
          type: 'CREDIT_CARD_PAYMENT',
          subType: null,
        };

        const fundingIntentMap = new Map();
        fundingIntentMap.set('cc-payment-with-map', { memo: 'Some memo' });

        // CREDIT_CARD_PAYMENT rule doesn't use fundingIntentMap
        const result = applyTransactionRule(transaction, fundingIntentMap);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Credit Card Payment');
        expect(result.notes).toBe(''); // memo should NOT be extracted
      });

      it('should use first credit card when multiple exist', () => {
        setupMockAccountsWithTypes([
          { id: 'cc-123', nickname: 'Primary Credit Card', type: 'CREDIT_CARD' },
          { id: 'cc-456', nickname: 'Secondary Credit Card', type: 'CREDIT_CARD' },
        ]);

        const transaction = {
          externalCanonicalId: 'cc-payment-multi',
          type: 'CREDIT_CARD_PAYMENT',
          subType: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Primary Credit Card');
        expect(result.originalStatement).toBe('Primary Credit Card');
      });
    });
  });

  describe('hasRuleForTransaction with CREDIT_CARD_PAYMENT', () => {
    it('should return true for CREDIT_CARD_PAYMENT type (with any subType)', () => {
      expect(hasRuleForTransaction('CREDIT_CARD_PAYMENT', 'SCHEDULED')).toBe(true);
      expect(hasRuleForTransaction('CREDIT_CARD_PAYMENT', 'MANUAL')).toBe(true);
      expect(hasRuleForTransaction('CREDIT_CARD_PAYMENT', null)).toBe(true);
      expect(hasRuleForTransaction('CREDIT_CARD_PAYMENT', undefined)).toBe(true);
    });

    it('should return false for non-CREDIT_CARD_PAYMENT types', () => {
      expect(hasRuleForTransaction('WITHDRAWAL', 'CREDIT_CARD_PAYMENT')).toBe(false);
      expect(hasRuleForTransaction('DEPOSIT', 'CREDIT_CARD_PAYMENT')).toBe(false);
    });
  });

  describe('PROMOTION/INCENTIVE_BONUS rule', () => {
    describe('rule matching', () => {
      it('should match transactions with type PROMOTION and subType INCENTIVE_BONUS', () => {
        const transaction = {
          externalCanonicalId: 'promo-123',
          type: 'PROMOTION',
          subType: 'INCENTIVE_BONUS',
          amount: 149.77,
          amountSign: 'positive',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'promotion-incentive-bonus');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const transaction = {
          externalCanonicalId: 'promo-123',
          type: 'DEPOSIT',
          subType: 'INCENTIVE_BONUS',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'promotion-incentive-bonus');
        expect(rule.match(transaction)).toBe(false);
      });

      it('should not match transactions with different subType', () => {
        const transaction = {
          externalCanonicalId: 'promo-123',
          type: 'PROMOTION',
          subType: 'REFERRAL',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'promotion-incentive-bonus');
        expect(rule.match(transaction)).toBe(false);
      });
    });

    describe('transaction processing', () => {
      it('should process PROMOTION/INCENTIVE_BONUS transaction correctly', () => {
        const transaction = {
          externalCanonicalId: '9898300',
          type: 'PROMOTION',
          subType: 'INCENTIVE_BONUS',
          amount: 149.77,
          amountSign: 'positive',
          unifiedStatus: 'COMPLETED',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('promotion-incentive-bonus');
        expect(result.category).toBeNull(); // Needs category mapping
        expect(result.merchant).toBe('Wealthsimple Incentive Bonus');
        expect(result.originalStatement).toBe('Wealthsimple Incentive Bonus');
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('PROMOTION:INCENTIVE_BONUS:Wealthsimple Incentive Bonus');
      });

      it('should include promotionDetails for category selector display', () => {
        const transaction = {
          externalCanonicalId: '9898300',
          type: 'PROMOTION',
          subType: 'INCENTIVE_BONUS',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.promotionDetails).toBeDefined();
        expect(result.promotionDetails.type).toBe('PROMOTION');
        expect(result.promotionDetails.subType).toBe('INCENTIVE_BONUS');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'promo-notes',
          type: 'PROMOTION',
          subType: 'INCENTIVE_BONUS',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });
  });

  describe('hasRuleForTransaction with PROMOTION/INCENTIVE_BONUS', () => {
    it('should return true for PROMOTION/INCENTIVE_BONUS type/subType', () => {
      expect(hasRuleForTransaction('PROMOTION', 'INCENTIVE_BONUS')).toBe(true);
    });

    it('should return false for PROMOTION with different subType', () => {
      expect(hasRuleForTransaction('PROMOTION', 'REFERRAL')).toBe(false);
      expect(hasRuleForTransaction('PROMOTION', null)).toBe(false);
    });

    it('should return false for INCENTIVE_BONUS with wrong type', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'INCENTIVE_BONUS')).toBe(false);
      expect(hasRuleForTransaction('REIMBURSEMENT', 'INCENTIVE_BONUS')).toBe(false);
    });
  });

  describe('REIMBURSEMENT/CASHBACK rule', () => {
    describe('rule matching', () => {
      it('should match transactions with type REIMBURSEMENT and subType CASHBACK', () => {
        const transaction = {
          externalCanonicalId: 'cashback-123',
          type: 'REIMBURSEMENT',
          subType: 'CASHBACK',
          amount: 6.36,
          amountSign: 'positive',
          rewardProgram: 'CREDIT_CARD_VISA_INFINITE_REWARDS',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'reimbursement-cashback');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const transaction = {
          externalCanonicalId: 'cashback-123',
          type: 'DEPOSIT',
          subType: 'CASHBACK',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'reimbursement-cashback');
        expect(rule.match(transaction)).toBe(false);
      });

      it('should not match transactions with different subType', () => {
        const transaction = {
          externalCanonicalId: 'cashback-123',
          type: 'REIMBURSEMENT',
          subType: 'ATM',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'reimbursement-cashback');
        expect(rule.match(transaction)).toBe(false);
      });
    });

    describe('transaction processing', () => {
      it('should process REIMBURSEMENT/CASHBACK transaction with rewardProgram', () => {
        const transaction = {
          externalCanonicalId: 'card-reward-payout-9kV7HnqpRpOxIcmn2HVA',
          type: 'REIMBURSEMENT',
          subType: 'CASHBACK',
          amount: 6.36,
          amountSign: 'positive',
          rewardProgram: 'CREDIT_CARD_VISA_INFINITE_REWARDS',
          status: 'completed',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('reimbursement-cashback');
        expect(result.category).toBe('Cashback');
        expect(result.merchant).toBe('Wealthsimple Cashback');
        expect(result.originalStatement).toBe('CREDIT_CARD_VISA_INFINITE_REWARDS');
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should use fallback original statement when rewardProgram is null', () => {
        const transaction = {
          externalCanonicalId: 'cashback-no-program',
          type: 'REIMBURSEMENT',
          subType: 'CASHBACK',
          amount: 10.00,
          amountSign: 'positive',
          rewardProgram: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Cashback');
        expect(result.merchant).toBe('Wealthsimple Cashback');
        expect(result.originalStatement).toBe('Wealthsimple Cashback');
      });

      it('should use fallback original statement when rewardProgram is undefined', () => {
        const transaction = {
          externalCanonicalId: 'cashback-undefined-program',
          type: 'REIMBURSEMENT',
          subType: 'CASHBACK',
          amount: 5.00,
          amountSign: 'positive',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('Wealthsimple Cashback');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'cashback-notes',
          type: 'REIMBURSEMENT',
          subType: 'CASHBACK',
          rewardProgram: 'SOME_PROGRAM',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });
  });

  describe('hasRuleForTransaction with REIMBURSEMENT/CASHBACK', () => {
    it('should return true for REIMBURSEMENT/CASHBACK type/subType', () => {
      expect(hasRuleForTransaction('REIMBURSEMENT', 'CASHBACK')).toBe(true);
    });

    it('should return false for REIMBURSEMENT with different subType', () => {
      expect(hasRuleForTransaction('REIMBURSEMENT', 'OTHER')).toBe(false);
    });

    it('should return false for CASHBACK with wrong type', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'CASHBACK')).toBe(false);
      expect(hasRuleForTransaction('PROMOTION', 'CASHBACK')).toBe(false);
    });
  });

  describe('P2P_PAYMENT rule', () => {
    describe('rule matching', () => {
      it('should match transactions with type P2P_PAYMENT and subType SEND', () => {
        const transaction = {
          externalCanonicalId: 'p2p-123',
          type: 'P2P_PAYMENT',
          subType: 'SEND',
          p2pHandle: '@johndoe',
          p2pMessage: 'Thanks for lunch!',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'p2p-payment');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match transactions with type P2P_PAYMENT and subType SEND_RECEIVED', () => {
        const transaction = {
          externalCanonicalId: 'p2p-456',
          type: 'P2P_PAYMENT',
          subType: 'SEND_RECEIVED',
          p2pHandle: '@janedoe',
          p2pMessage: 'For dinner',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'p2p-payment');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'SEND',
          p2pHandle: '@johndoe',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'p2p-payment');
        expect(rule.match(transaction)).toBe(false);
      });

      it('should not match transactions with different subType', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'P2P_PAYMENT',
          subType: 'OTHER',
          p2pHandle: '@johndoe',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'p2p-payment');
        expect(rule.match(transaction)).toBe(false);
      });
    });

    describe('SEND transactions (outgoing)', () => {
      it('should process P2P_PAYMENT/SEND transaction correctly', () => {
        const transaction = {
          externalCanonicalId: 'p2p-send-123',
          type: 'P2P_PAYMENT',
          subType: 'SEND',
          p2pHandle: '@johndoe',
          p2pMessage: 'Thanks for lunch!',
          amount: 25.00,
          amountSign: 'negative',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('p2p-payment');
        expect(result.category).toBeNull();
        expect(result.merchant).toBe('Transfer to @johndoe');
        expect(result.originalStatement).toBe('Transfer to @johndoe');
        expect(result.notes).toBe('Thanks for lunch!');
        expect(result.technicalDetails).toBe('');
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('P2P_PAYMENT:SEND:@johndoe');
      });

      it('should include p2pDetails for category selector display', () => {
        const transaction = {
          externalCanonicalId: 'p2p-send-details',
          type: 'P2P_PAYMENT',
          subType: 'SEND',
          p2pHandle: '@alice',
          p2pMessage: 'Coffee money',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.p2pDetails).toBeDefined();
        expect(result.p2pDetails.type).toBe('P2P_PAYMENT');
        expect(result.p2pDetails.subType).toBe('SEND');
        expect(result.p2pDetails.p2pHandle).toBe('@alice');
      });
    });

    describe('SEND_RECEIVED transactions (incoming)', () => {
      it('should process P2P_PAYMENT/SEND_RECEIVED transaction correctly', () => {
        const transaction = {
          externalCanonicalId: 'p2p-receive-123',
          type: 'P2P_PAYMENT',
          subType: 'SEND_RECEIVED',
          p2pHandle: '@janedoe',
          p2pMessage: 'For dinner',
          amount: 30.00,
          amountSign: 'positive',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('p2p-payment');
        expect(result.category).toBeNull();
        expect(result.merchant).toBe('Transfer from @janedoe');
        expect(result.originalStatement).toBe('Transfer from @janedoe');
        expect(result.notes).toBe('For dinner');
        expect(result.technicalDetails).toBe('');
        expect(result.needsCategoryMapping).toBe(true);
        expect(result.categoryKey).toBe('P2P_PAYMENT:SEND_RECEIVED:@janedoe');
      });

      it('should include p2pDetails for category selector display', () => {
        const transaction = {
          externalCanonicalId: 'p2p-receive-details',
          type: 'P2P_PAYMENT',
          subType: 'SEND_RECEIVED',
          p2pHandle: '@bob',
          p2pMessage: 'Paying you back',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.p2pDetails).toBeDefined();
        expect(result.p2pDetails.type).toBe('P2P_PAYMENT');
        expect(result.p2pDetails.subType).toBe('SEND_RECEIVED');
        expect(result.p2pDetails.p2pHandle).toBe('@bob');
      });
    });

    describe('edge cases', () => {
      it('should handle missing p2pHandle with Unknown fallback', () => {
        const transaction = {
          externalCanonicalId: 'p2p-no-handle',
          type: 'P2P_PAYMENT',
          subType: 'SEND',
          p2pHandle: null,
          p2pMessage: 'Test message',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer to Unknown');
        expect(result.originalStatement).toBe('Transfer to Unknown');
        expect(result.categoryKey).toBe('P2P_PAYMENT:SEND:Unknown');
        expect(result.p2pDetails.p2pHandle).toBe('Unknown');
      });

      it('should handle empty p2pHandle with Unknown fallback', () => {
        const transaction = {
          externalCanonicalId: 'p2p-empty-handle',
          type: 'P2P_PAYMENT',
          subType: 'SEND_RECEIVED',
          p2pHandle: '',
          p2pMessage: 'Test',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer from Unknown');
        expect(result.originalStatement).toBe('Transfer from Unknown');
        expect(result.categoryKey).toBe('P2P_PAYMENT:SEND_RECEIVED:Unknown');
      });

      it('should handle missing p2pMessage with empty string', () => {
        const transaction = {
          externalCanonicalId: 'p2p-no-message',
          type: 'P2P_PAYMENT',
          subType: 'SEND',
          p2pHandle: '@johndoe',
          p2pMessage: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
      });

      it('should handle empty p2pMessage with empty string', () => {
        const transaction = {
          externalCanonicalId: 'p2p-empty-message',
          type: 'P2P_PAYMENT',
          subType: 'SEND',
          p2pHandle: '@johndoe',
          p2pMessage: '',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
      });

      it('should handle undefined p2pMessage', () => {
        const transaction = {
          externalCanonicalId: 'p2p-undefined-message',
          type: 'P2P_PAYMENT',
          subType: 'SEND_RECEIVED',
          p2pHandle: '@janedoe',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
      });

      it('should handle both p2pHandle and p2pMessage missing', () => {
        const transaction = {
          externalCanonicalId: 'p2p-all-missing',
          type: 'P2P_PAYMENT',
          subType: 'SEND',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer to Unknown');
        expect(result.originalStatement).toBe('Transfer to Unknown');
        expect(result.categoryKey).toBe('P2P_PAYMENT:SEND:Unknown');
        expect(result.notes).toBe('');
        expect(result.p2pDetails.p2pHandle).toBe('Unknown');
      });
    });
  });

  describe('hasRuleForTransaction with P2P_PAYMENT', () => {
    it('should return true for P2P_PAYMENT/SEND type/subType', () => {
      expect(hasRuleForTransaction('P2P_PAYMENT', 'SEND')).toBe(true);
    });

    it('should return true for P2P_PAYMENT/SEND_RECEIVED type/subType', () => {
      expect(hasRuleForTransaction('P2P_PAYMENT', 'SEND_RECEIVED')).toBe(true);
    });

    it('should return false for P2P_PAYMENT with different subType', () => {
      expect(hasRuleForTransaction('P2P_PAYMENT', 'OTHER')).toBe(false);
      expect(hasRuleForTransaction('P2P_PAYMENT', null)).toBe(false);
      expect(hasRuleForTransaction('P2P_PAYMENT', 'RECEIVE')).toBe(false);
    });

    it('should return false for SEND/SEND_RECEIVED with wrong type', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'SEND')).toBe(false);
      expect(hasRuleForTransaction('WITHDRAWAL', 'SEND_RECEIVED')).toBe(false);
    });
  });

  describe('REIMBURSEMENT/ATM rule', () => {
    describe('rule matching', () => {
      it('should match transactions with type REIMBURSEMENT and subType ATM', () => {
        const transaction = {
          externalCanonicalId: 'atm-reimbursement-123',
          type: 'REIMBURSEMENT',
          subType: 'ATM',
          amount: 3.00,
          amountSign: 'positive',
          status: null, // ATM reimbursements have null status
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'reimbursement-atm');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const transaction = {
          externalCanonicalId: 'atm-123',
          type: 'WITHDRAWAL',
          subType: 'ATM',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'reimbursement-atm');
        expect(rule.match(transaction)).toBe(false);
      });

      it('should not match transactions with different subType', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-123',
          type: 'REIMBURSEMENT',
          subType: 'CASHBACK',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'reimbursement-atm');
        expect(rule.match(transaction)).toBe(false);
      });
    });

    describe('transaction processing', () => {
      it('should process REIMBURSEMENT/ATM transaction correctly', () => {
        const transaction = {
          externalCanonicalId: 'atm-fee-reimbursement-456',
          type: 'REIMBURSEMENT',
          subType: 'ATM',
          amount: 3.00,
          amountSign: 'positive',
          status: null,
          unifiedStatus: 'COMPLETED',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('reimbursement-atm');
        expect(result.category).toBe('Cash & ATM');
        expect(result.merchant).toBe('ATM Fee Reimbursement');
        expect(result.originalStatement).toBe('ATM Fee Reimbursement');
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should process even when status is null', () => {
        const transaction = {
          externalCanonicalId: 'atm-null-status',
          type: 'REIMBURSEMENT',
          subType: 'ATM',
          amount: 5.00,
          amountSign: 'positive',
          status: null,
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Cash & ATM');
        expect(result.merchant).toBe('ATM Fee Reimbursement');
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'atm-notes',
          type: 'REIMBURSEMENT',
          subType: 'ATM',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });
  });

  describe('hasRuleForTransaction with REIMBURSEMENT/ATM', () => {
    it('should return true for REIMBURSEMENT/ATM type/subType', () => {
      expect(hasRuleForTransaction('REIMBURSEMENT', 'ATM')).toBe(true);
    });

    it('should return false for ATM with wrong type', () => {
      expect(hasRuleForTransaction('WITHDRAWAL', 'ATM')).toBe(false);
      expect(hasRuleForTransaction('SPEND', 'ATM')).toBe(false);
    });
  });

  describe('EFT_RECURRING rule', () => {
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
      setupMockAccounts([
        { id: 'account-cash-123', nickname: 'Wealthsimple Cash' },
      ]);
    });

    describe('rule matching', () => {
      it('should match transactions with subType EFT_RECURRING', () => {
        const transaction = {
          externalCanonicalId: 'eft-recurring-123',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          accountId: 'account-cash-123',
          frequency: 'MONTHLY',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'eft-transfer');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should still match transactions with subType EFT', () => {
        const transaction = {
          externalCanonicalId: 'eft-123',
          type: 'DEPOSIT',
          subType: 'EFT',
          accountId: 'account-cash-123',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'eft-transfer');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should not match transactions with different subType', () => {
        const transaction = {
          externalCanonicalId: 'tx-123',
          type: 'DEPOSIT',
          subType: 'E_TRANSFER',
        };

        const rule = CASH_TRANSACTION_RULES.find((r) => r.id === 'eft-transfer');
        expect(rule.match(transaction)).toBe(false);
      });
    });

    describe('frequency prefix for EFT_RECURRING', () => {
      it('should add Monthly frequency prefix for DEPOSIT/EFT_RECURRING', () => {
        const transaction = {
          externalCanonicalId: 'eft-recurring-deposit',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          accountId: 'account-cash-123',
          frequency: 'MONTHLY',
        };

        const fundsTransferMap = new Map();
        fundsTransferMap.set('eft-recurring-deposit', {
          source: {
            bankAccount: {
              institutionName: 'TD Bank',
              nickname: 'Chequing',
              accountNumber: '12345',
            },
          },
        });

        const result = applyTransactionRule(transaction, fundsTransferMap);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('eft-transfer');
        expect(result.merchant).toBe('Monthly Transfer in: Wealthsimple Cash ← TD Bank/Chequing');
        expect(result.category).toBe('Transfer');
      });

      it('should add Weekly frequency prefix for WITHDRAWAL/EFT_RECURRING', () => {
        const transaction = {
          externalCanonicalId: 'eft-recurring-withdrawal',
          type: 'WITHDRAWAL',
          subType: 'EFT_RECURRING',
          accountId: 'account-cash-123',
          frequency: 'WEEKLY',
        };

        const fundsTransferMap = new Map();
        fundsTransferMap.set('eft-recurring-withdrawal', {
          destination: {
            bankAccount: {
              institutionName: 'RBC',
              nickname: 'Savings',
              accountNumber: '67890',
            },
          },
        });

        const result = applyTransactionRule(transaction, fundsTransferMap);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('eft-transfer');
        expect(result.merchant).toBe('Weekly Transfer out: Wealthsimple Cash → RBC/Savings');
      });

      it('should capitalize frequency properly (e.g., BIWEEKLY -> Biweekly)', () => {
        const transaction = {
          externalCanonicalId: 'eft-recurring-biweekly',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          accountId: 'account-cash-123',
          frequency: 'BIWEEKLY',
        };

        const fundsTransferMap = new Map();
        fundsTransferMap.set('eft-recurring-biweekly', {
          source: {
            bankAccount: {
              institutionName: 'Scotiabank',
              nickname: 'Main Account',
              accountNumber: '11111',
            },
          },
        });

        const result = applyTransactionRule(transaction, fundsTransferMap);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Biweekly Transfer in: Wealthsimple Cash ← Scotiabank/Main Account');
      });

      it('should NOT add prefix when frequency is null', () => {
        const transaction = {
          externalCanonicalId: 'eft-recurring-no-freq',
          type: 'DEPOSIT',
          subType: 'EFT_RECURRING',
          accountId: 'account-cash-123',
          frequency: null,
        };

        const fundsTransferMap = new Map();
        fundsTransferMap.set('eft-recurring-no-freq', {
          source: {
            bankAccount: {
              institutionName: 'BMO',
              nickname: 'Personal',
              accountNumber: '22222',
            },
          },
        });

        const result = applyTransactionRule(transaction, fundsTransferMap);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer in: Wealthsimple Cash ← BMO/Personal');
      });

      it('should NOT add prefix when frequency is undefined', () => {
        const transaction = {
          externalCanonicalId: 'eft-recurring-undef-freq',
          type: 'WITHDRAWAL',
          subType: 'EFT_RECURRING',
          accountId: 'account-cash-123',
          // frequency not set
        };

        const fundsTransferMap = new Map();
        fundsTransferMap.set('eft-recurring-undef-freq', {
          destination: {
            bankAccount: {
              institutionName: 'CIBC',
              nickname: 'Savings',
              accountNumber: '33333',
            },
          },
        });

        const result = applyTransactionRule(transaction, fundsTransferMap);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer out: Wealthsimple Cash → CIBC/Savings');
      });

      it('should NOT add frequency prefix for regular EFT (non-recurring)', () => {
        const transaction = {
          externalCanonicalId: 'eft-regular',
          type: 'DEPOSIT',
          subType: 'EFT',
          accountId: 'account-cash-123',
          frequency: 'MONTHLY', // Even if frequency is present, should not add prefix for EFT
        };

        const fundsTransferMap = new Map();
        fundsTransferMap.set('eft-regular', {
          source: {
            bankAccount: {
              institutionName: 'TD Bank',
              nickname: 'Chequing',
              accountNumber: '44444',
            },
          },
        });

        const result = applyTransactionRule(transaction, fundsTransferMap);

        expect(result).not.toBeNull();
        // Regular EFT should NOT have frequency prefix
        expect(result.merchant).toBe('Transfer in: Wealthsimple Cash ← TD Bank/Chequing');
      });
    });
  });

  describe('hasRuleForTransaction with EFT_RECURRING', () => {
    it('should return true for EFT_RECURRING subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'EFT_RECURRING')).toBe(true);
      expect(hasRuleForTransaction('WITHDRAWAL', 'EFT_RECURRING')).toBe(true);
    });

    it('should still return true for EFT subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'EFT')).toBe(true);
      expect(hasRuleForTransaction('WITHDRAWAL', 'EFT')).toBe(true);
    });
  });
});
