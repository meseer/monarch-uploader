/**
 * Tests for Wealthsimple Transaction Rules Engine
 */

import {
  CASH_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
} from '../../../src/services/wealthsimple/transactionRules';

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
        type: 'INTEREST',
        subType: 'MARGIN_INTEREST', // No rule for this
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

    it('should return false for unsupported subTypes', () => {
      expect(hasRuleForTransaction('DEPOSIT', 'INTERNAL_TRANSFER')).toBe(false);
      expect(hasRuleForTransaction('INTEREST', 'MARGIN_INTEREST')).toBe(false);
    });

    it('should return false for undefined subType', () => {
      expect(hasRuleForTransaction('DEPOSIT', undefined)).toBe(false);
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
});
