/**
 * Tests for Wealthsimple Transaction Rules Engine - Cash Internal Transfer Rules
 *
 * Covers: INTERNAL_TRANSFER rule, getAccountNameById, hasRuleForTransaction with INTERNAL_TRANSFER,
 * WITHDRAWAL/BILL_PAY rule, INTEREST rule, extractInternalTransferAnnotation,
 * INTERNAL_TRANSFER rule with annotation, getAccountNameByType
 */

import {
  CASH_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
  getAccountNameById,
  getAccountNameByType,
  extractInternalTransferAnnotation,
} from '../../../src/services/wealthsimple/transactionRules';
import { STORAGE } from '../../../src/core/config';

describe('Wealthsimple Transaction Rules Engine - Cash Internal', () => {
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
      it('should process DESTINATION transfer with correct format (notes are empty without annotation)', () => {
        const transaction = {
          externalCanonicalId: 'transfer-dest-123',
          type: 'INTERNAL_TRANSFER',
          subType: 'DESTINATION',
          accountId: 'account-tfsa-456',
          opposingAccountId: 'account-cash-123',
          amount: 500,
          amountSign: 'positive',
          currency: 'CAD',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('internal-transfer');
        expect(result.category).toBe('Transfer');
        // Format: Transfer In: Destination ← Source
        expect(result.merchant).toBe('Transfer In: Wealthsimple TFSA (5678) ← Wealthsimple Cash (1234)');
        expect(result.originalStatement).toBe('INTERNAL_TRANSFER:DESTINATION:Transfer In: Wealthsimple TFSA (5678) ← Wealthsimple Cash (1234)');
        expect(result.notes).toBe(''); // Notes only contain annotation (no transfer amount)
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
      it('should process SOURCE transfer with correct format (notes are empty without annotation)', () => {
        const transaction = {
          externalCanonicalId: 'transfer-src-123',
          type: 'INTERNAL_TRANSFER',
          subType: 'SOURCE',
          accountId: 'account-cash-123',
          opposingAccountId: 'account-tfsa-456',
          amount: 500,
          amountSign: 'negative',
          currency: 'CAD',
        };

        const result = applyTransactionRule(transaction);

        expect(result).not.toBeNull();
        expect(result.ruleId).toBe('internal-transfer');
        expect(result.category).toBe('Transfer');
        // Format: Transfer Out: Current → Opposing
        expect(result.merchant).toBe('Transfer Out: Wealthsimple Cash (1234) → Wealthsimple TFSA (5678)');
        expect(result.originalStatement).toBe('INTERNAL_TRANSFER:SOURCE:Transfer Out: Wealthsimple Cash (1234) → Wealthsimple TFSA (5678)');
        expect(result.notes).toBe(''); // Notes only contain annotation (no transfer amount)
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
        expect(result.originalStatement).toBe('WITHDRAWAL:BILL_PAY:BC Hydro (****5678)');
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
        expect(result.originalStatement).toBe('WITHDRAWAL:BILL_PAY:Unknown Company (****1111)');
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
        expect(result.originalStatement).toBe('WITHDRAWAL:BILL_PAY:Enbridge Gas ()');
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
        expect(result.originalStatement).toBe('WITHDRAWAL:BILL_PAY:Unknown Company ()');
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
        expect(result.originalStatement).toBe('WITHDRAWAL:BILL_PAY:Unknown Company (****3333)');
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
        expect(result.originalStatement).toMatch(/^INTEREST:[^:]*:Interest: Wealthsimple Cash \(1234\)$/);
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
        expect(result.originalStatement).toMatch(/^INTEREST:[^:]*:Interest: Wealthsimple Cash USD \(5678\)$/);
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
        expect(result.originalStatement).toMatch(/^INTEREST:[^:]*:Interest: Unknown Account$/);
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
        expect(result.originalStatement).toMatch(/^INTEREST:[^:]*:Interest: Unknown Account$/);
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
        expect(result.originalStatement).toMatch(/^INTEREST:[^:]*:Interest: Unknown Account$/);
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

    it('should include annotation as notes when internalTransferMap is provided', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
        amount: 500,
        currency: 'CAD',
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
        amount: 300,
        currency: 'USD',
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
        amount: 250,
        currency: 'CAD',
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
        amount: 100,
        currency: 'CAD',
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
        amount: 750,
        currency: 'USD',
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
        amount: 200,
        currency: 'CAD',
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

    it('should return empty notes when internalTransferMap is empty', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        type: 'INTERNAL_TRANSFER',
        subType: 'DESTINATION',
        accountId: 'account-tfsa-456',
        opposingAccountId: 'account-cash-123',
        amount: 1000,
        currency: 'CAD',
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
});
