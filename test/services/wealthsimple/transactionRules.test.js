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

    it('should return empty notes when fundingIntentMap is null', () => {
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
    it('should include auto-deposit and reference number for outgoing e-transfer', () => {
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
      expect(result.notes).toBe('Auto Deposit: No; Reference Number: CAkJgEwf');
    });

    it('should include memo and transfer details on separate lines for outgoing e-transfer', () => {
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
      expect(result.notes).toBe('Line Honeybadger Skis\nAuto Deposit: Yes; Reference Number: C1AnSCH9shHa');
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
      // Only memo should be present, no transfer details
      expect(result.notes).toBe('Payment for groceries');
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
      expect(result.notes).toBe('Auto Deposit: No');
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
      expect(result.notes).toBe('Reference Number: CAkJgEwf');
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
    });
  });
});
