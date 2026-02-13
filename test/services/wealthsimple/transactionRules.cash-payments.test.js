/**
 * Tests for Wealthsimple Transaction Rules Engine - Cash Payment Rules
 *
 * Covers: CREDIT_CARD_PAYMENT rule, PROMOTION/INCENTIVE_BONUS rule,
 * REIMBURSEMENT/CASHBACK rule, P2P_PAYMENT rule, REIMBURSEMENT/ATM rule,
 * EFT_RECURRING rule, getTransactionId
 */

import {
  CASH_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
  getTransactionId,
} from '../../../src/services/wealthsimple/transactionRules';
import { STORAGE } from '../../../src/core/config';

describe('Wealthsimple Transaction Rules Engine - Cash Payments', () => {
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
        expect(result.originalStatement).toMatch(/^CREDIT_CARD_PAYMENT:[^:]*:Wealthsimple Credit Card \(1234\)$/);
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
        expect(result.originalStatement).toMatch(/^CREDIT_CARD_PAYMENT:[^:]*:Wealthsimple Credit Card$/);
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
        expect(result.originalStatement).toMatch(/^CREDIT_CARD_PAYMENT:[^:]*:Wealthsimple Credit Card$/);
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
        expect(result.originalStatement).toMatch(/^CREDIT_CARD_PAYMENT:[^:]*:Wealthsimple Credit Card$/);
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
        expect(result.originalStatement).toMatch(/^CREDIT_CARD_PAYMENT:[^:]*:Wealthsimple Credit Card$/);
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
        expect(result.originalStatement).toMatch(/^CREDIT_CARD_PAYMENT:[^:]*:Primary Credit Card$/);
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
        expect(result.originalStatement).toBe('PROMOTION:INCENTIVE_BONUS:Wealthsimple Incentive Bonus');
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
        expect(result.category).toBe('Cash Back');
        expect(result.merchant).toBe('Wealthsimple Cashback');
        expect(result.originalStatement).toBe('REIMBURSEMENT:CASHBACK:CREDIT_CARD_VISA_INFINITE_REWARDS');
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
        expect(result.category).toBe('Cash Back');
        expect(result.merchant).toBe('Wealthsimple Cashback');
        expect(result.originalStatement).toBe('REIMBURSEMENT:CASHBACK:Wealthsimple Cashback');
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
        expect(result.originalStatement).toBe('REIMBURSEMENT:CASHBACK:Wealthsimple Cashback');
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
        expect(result.originalStatement).toBe('P2P_PAYMENT:SEND:Transfer to @johndoe');
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
        expect(result.originalStatement).toBe('P2P_PAYMENT:SEND_RECEIVED:Transfer from @janedoe');
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
        expect(result.originalStatement).toBe('P2P_PAYMENT:SEND:Transfer to Unknown');
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
        expect(result.originalStatement).toBe('P2P_PAYMENT:SEND_RECEIVED:Transfer from Unknown');
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
        expect(result.originalStatement).toBe('P2P_PAYMENT:SEND:Transfer to Unknown');
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
        expect(result.originalStatement).toBe('REIMBURSEMENT:ATM:ATM Fee Reimbursement');
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
        expect(result.merchant).toBe('Monthly Transfer In: Wealthsimple Cash ← TD Bank/Chequing');
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
        expect(result.merchant).toBe('Weekly Transfer Out: Wealthsimple Cash → RBC/Savings');
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
        expect(result.merchant).toBe('Biweekly Transfer In: Wealthsimple Cash ← Scotiabank/Main Account');
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
        expect(result.merchant).toBe('Transfer In: Wealthsimple Cash ← BMO/Personal');
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
        expect(result.merchant).toBe('Transfer Out: Wealthsimple Cash → CIBC/Savings');
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
        expect(result.merchant).toBe('Transfer In: Wealthsimple Cash ← TD Bank/Chequing');
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

  describe('getTransactionId', () => {
    it('should return externalCanonicalId when present', () => {
      const transaction = {
        externalCanonicalId: 'funding_intent-abc123',
        canonicalId: 'JAN-26:1234567:8901234:567',
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        amount: '100.00',
        currency: 'CAD',
      };

      expect(getTransactionId(transaction)).toBe('funding_intent-abc123');
    });

    it('should fall back to canonicalId when externalCanonicalId is null', () => {
      const transaction = {
        externalCanonicalId: null,
        canonicalId: 'JAN-26:1581542712:5288071445:208',
        accountId: 'ca-cash-msb-WKYNdSTqrA',
        occurredAt: '2026-01-01T05:00:00.000000+00:00',
        type: 'INTEREST',
        subType: null,
        amount: '3.47',
        currency: 'CAD',
      };

      expect(getTransactionId(transaction)).toBe('JAN-26:1581542712:5288071445:208');
    });

    it('should fall back to canonicalId when externalCanonicalId is undefined', () => {
      const transaction = {
        canonicalId: 'JAN-26:1581542712:5288071445:208',
        accountId: 'ca-cash-msb-WKYNdSTqrA',
        occurredAt: '2026-01-01T05:00:00.000000+00:00',
        type: 'INTEREST',
        subType: null,
        amount: '3.47',
        currency: 'CAD',
      };

      expect(getTransactionId(transaction)).toBe('JAN-26:1581542712:5288071445:208');
    });

    it('should generate deterministic ID when both externalCanonicalId and canonicalId are null', () => {
      const transaction = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: 'ca-cash-msb-WKYNdSTqrA',
        occurredAt: '2026-01-01T05:00:00.000000+00:00',
        type: 'INTEREST',
        subType: 'SAVINGS',
        amount: '3.47',
        currency: 'CAD',
      };

      const result = getTransactionId(transaction);
      expect(result).toBe('generated:ca-cash-msb-WKYNdSTqrA:2026-01-01T05:00:00.000000+00:00:INTEREST:SAVINGS:3.47:CAD');
    });

    it('should generate deterministic ID with empty strings for missing fields', () => {
      const transaction = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: null,
        occurredAt: null,
        type: null,
        subType: null,
        amount: null,
        currency: null,
      };

      const result = getTransactionId(transaction);
      expect(result).toBe('generated::::::');
    });

    it('should handle undefined fields in generated ID', () => {
      const transaction = {
        // All fields undefined
      };

      const result = getTransactionId(transaction);
      expect(result).toBe('generated::::::');
    });

    it('should generate same ID for same transaction data (deterministic)', () => {
      const transaction1 = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        amount: '100.00',
        currency: 'CAD',
      };

      const transaction2 = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'DEPOSIT',
        subType: 'E_TRANSFER',
        amount: '100.00',
        currency: 'CAD',
      };

      expect(getTransactionId(transaction1)).toBe(getTransactionId(transaction2));
    });

    it('should generate different ID for different transaction data', () => {
      const transaction1 = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'INTEREST',
        subType: null,
        amount: '3.47',
        currency: 'CAD',
      };

      const transaction2 = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'INTEREST',
        subType: null,
        amount: '5.00', // Different amount
        currency: 'CAD',
      };

      expect(getTransactionId(transaction1)).not.toBe(getTransactionId(transaction2));
    });

    it('should handle amount as number in generated ID', () => {
      const transaction = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'INTEREST',
        subType: null,
        amount: 3.47, // number, not string
        currency: 'CAD',
      };

      const result = getTransactionId(transaction);
      expect(result).toBe('generated:test-account:2026-01-15T10:30:00.000000+00:00:INTEREST::3.47:CAD');
    });

    it('should handle amount of 0 correctly', () => {
      const transaction = {
        externalCanonicalId: null,
        canonicalId: null,
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'FEE',
        subType: 'WAIVED',
        amount: 0,
        currency: 'CAD',
      };

      const result = getTransactionId(transaction);
      expect(result).toBe('generated:test-account:2026-01-15T10:30:00.000000+00:00:FEE:WAIVED:0:CAD');
    });

    it('should prefer externalCanonicalId over canonicalId even if both present', () => {
      const transaction = {
        externalCanonicalId: 'external-id-123',
        canonicalId: 'canonical-id-456',
        accountId: 'test-account',
        type: 'DEPOSIT',
      };

      expect(getTransactionId(transaction)).toBe('external-id-123');
    });

    it('should prefer canonicalId over generated ID', () => {
      const transaction = {
        externalCanonicalId: null,
        canonicalId: 'canonical-id-789',
        accountId: 'test-account',
        occurredAt: '2026-01-15T10:30:00.000000+00:00',
        type: 'INTEREST',
        amount: '5.00',
        currency: 'CAD',
      };

      expect(getTransactionId(transaction)).toBe('canonical-id-789');
    });
  });
});
