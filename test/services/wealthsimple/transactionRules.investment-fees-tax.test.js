/**
 * Tests for Wealthsimple Transaction Rules Engine - Investment Fee & Tax Rules
 *
 * Covers: formatShortOptionExpiryNotes, INVESTMENT_FEE_TRANSACTION_RULES,
 * INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES, INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES
 */

import {
  INVESTMENT_FEE_TRANSACTION_RULES,
  INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES,
  INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES,
  formatShortOptionExpiryNotes,
} from '../../../src/services/wealthsimple/transactionRules';
import { STORAGE } from '../../../src/core/config';

describe('Wealthsimple Transaction Rules Engine - Investment Fees & Tax', () => {
  describe('formatShortOptionExpiryNotes', () => {
    it('should return empty string for null expiryDetail', () => {
      expect(formatShortOptionExpiryNotes(null)).toBe('');
    });

    it('should return empty string for undefined expiryDetail', () => {
      expect(formatShortOptionExpiryNotes(undefined)).toBe('');
    });

    it('should format notes with decision and reason', () => {
      const expiryDetail = {
        decision: 'EXPIRE',
        reason: 'OUT_OF_THE_MONEY',
        deliverables: [],
      };

      const result = formatShortOptionExpiryNotes(expiryDetail);

      expect(result).toBe('Decision: EXPIRE, reason: OUT_OF_THE_MONEY. Released collateral:');
    });

    it('should format deliverables with static security names (CAD/USD)', () => {
      const expiryDetail = {
        decision: 'EXPIRE',
        reason: 'OUT_OF_THE_MONEY',
        deliverables: [
          { quantity: 100, securityId: 'sec-s-cad' },
          { quantity: 50, securityId: 'sec-s-usd' },
        ],
      };

      const result = formatShortOptionExpiryNotes(expiryDetail, new Map());

      expect(result).toContain('Decision: EXPIRE, reason: OUT_OF_THE_MONEY. Released collateral:');
      expect(result).toContain('\n100 CAD');
      expect(result).toContain('\n50 USD');
    });

    it('should look up security names from cache', () => {
      const expiryDetail = {
        decision: 'ASSIGN',
        reason: 'IN_THE_MONEY',
        deliverables: [
          { quantity: 200, securityId: 'sec-o-abc123' },
        ],
      };

      const securityCache = new Map();
      securityCache.set('sec-o-abc123', { stock: { symbol: 'AAPL' } });

      const result = formatShortOptionExpiryNotes(expiryDetail, securityCache);

      expect(result).toContain('Decision: ASSIGN, reason: IN_THE_MONEY. Released collateral:');
      expect(result).toContain('\n200 AAPL');
    });

    it('should fall back to securityId when not in cache', () => {
      const expiryDetail = {
        decision: 'EXPIRE',
        reason: 'UNKNOWN',
        deliverables: [
          { quantity: 50, securityId: 'sec-o-notfound' },
        ],
      };

      const result = formatShortOptionExpiryNotes(expiryDetail, new Map());

      expect(result).toContain('\n50 sec-o-notfound');
    });

    it('should handle missing decision and reason with Unknown fallback', () => {
      const expiryDetail = {
        decision: null,
        reason: null,
        deliverables: [],
      };

      const result = formatShortOptionExpiryNotes(expiryDetail);

      expect(result).toBe('Decision: Unknown, reason: Unknown. Released collateral:');
    });

    it('should handle missing deliverables', () => {
      const expiryDetail = {
        decision: 'EXPIRE',
        reason: 'OUT_OF_THE_MONEY',
        deliverables: null,
      };

      const result = formatShortOptionExpiryNotes(expiryDetail);

      expect(result).toBe('Decision: EXPIRE, reason: OUT_OF_THE_MONEY. Released collateral:');
    });
  });

  describe('INVESTMENT_FEE_TRANSACTION_RULES', () => {
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
        { id: 'account-tfsa-123', nickname: 'Wealthsimple TFSA' },
        { id: 'account-rrsp-456', nickname: 'My RRSP Account' },
      ]);
    });

    describe('FEE rule matching', () => {
      it('should match transactions with type FEE', () => {
        const transaction = {
          externalCanonicalId: 'fee-123',
          type: 'FEE',
          subType: 'SERVICE_FEE',
          accountId: 'account-tfsa-123',
          currency: 'CAD',
          amount: 10.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match FEE with any subType', () => {
        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');

        expect(rule.match({ type: 'FEE', subType: 'SERVICE_FEE' })).toBe(true);
        expect(rule.match({ type: 'FEE', subType: 'MANAGEMENT_FEE' })).toBe(true);
        expect(rule.match({ type: 'FEE', subType: null })).toBe(true);
        expect(rule.match({ type: 'FEE', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');

        expect(rule.match({ type: 'REFUND', subType: 'FEE' })).toBe(false);
        expect(rule.match({ type: 'DEPOSIT', subType: 'SERVICE_FEE' })).toBe(false);
        expect(rule.match({ type: 'DIVIDEND', subType: null })).toBe(false);
      });
    });

    describe('FEE transaction processing with subType', () => {
      it('should process FEE with subType SERVICE_FEE correctly', () => {
        const transaction = {
          externalCanonicalId: 'fee-service-123',
          type: 'FEE',
          subType: 'SERVICE_FEE',
          accountId: 'account-tfsa-123',
          currency: 'CAD',
          amount: 15.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Service fee (Wealthsimple TFSA)');
        expect(result.originalStatement).toBe('FEE:SERVICE_FEE:CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process FEE with subType MANAGEMENT_FEE correctly', () => {
        const transaction = {
          externalCanonicalId: 'fee-mgmt-123',
          type: 'FEE',
          subType: 'MANAGEMENT_FEE',
          accountId: 'account-rrsp-456',
          currency: 'CAD',
          amount: 25.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Management fee (My RRSP Account)');
        expect(result.originalStatement).toBe('FEE:MANAGEMENT_FEE:CAD');
      });

      it('should handle complex subTypes with underscores using sentenceCase', () => {
        const transaction = {
          externalCanonicalId: 'fee-complex-123',
          type: 'FEE',
          subType: 'ACCOUNT_MAINTENANCE_FEE',
          accountId: 'account-tfsa-123',
          currency: 'USD',
          amount: 5.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Account maintenance fee (Wealthsimple TFSA)');
        expect(result.originalStatement).toBe('FEE:ACCOUNT_MAINTENANCE_FEE:USD');
      });
    });

    describe('FEE transaction processing without subType', () => {
      it('should process FEE with null subType using "Fee ({accountName})" as merchant', () => {
        const transaction = {
          externalCanonicalId: 'fee-null-subtype',
          type: 'FEE',
          subType: null,
          accountId: 'account-tfsa-123',
          currency: 'CAD',
          amount: 10.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Fee (Wealthsimple TFSA)');
        expect(result.originalStatement).toBe('FEE::CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process FEE with undefined subType using "Fee ({accountName})" as merchant', () => {
        const transaction = {
          externalCanonicalId: 'fee-undef-subtype',
          type: 'FEE',
          accountId: 'account-rrsp-456',
          currency: 'CAD',
          amount: 8.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Fee (My RRSP Account)');
        expect(result.originalStatement).toBe('FEE::CAD');
      });

      it('should process FEE with empty string subType using "Fee ({accountName})" as merchant', () => {
        const transaction = {
          externalCanonicalId: 'fee-empty-subtype',
          type: 'FEE',
          subType: '',
          accountId: 'account-tfsa-123',
          currency: 'CAD',
          amount: 12.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Fee (Wealthsimple TFSA)');
        expect(result.originalStatement).toBe('FEE::CAD');
      });
    });

    describe('FEE edge cases', () => {
      it('should handle missing accountId with Unknown Account fallback', () => {
        const transaction = {
          externalCanonicalId: 'fee-no-account',
          type: 'FEE',
          subType: 'SERVICE_FEE',
          accountId: null,
          currency: 'CAD',
          amount: 5.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Service fee (Unknown Account)');
        expect(result.originalStatement).toBe('FEE:SERVICE_FEE:CAD');
      });

      it('should handle unknown accountId with Unknown Account fallback', () => {
        const transaction = {
          externalCanonicalId: 'fee-unknown-account',
          type: 'FEE',
          subType: 'MANAGEMENT_FEE',
          accountId: 'account-unknown-999',
          currency: 'CAD',
          amount: 3.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Management fee (Unknown Account)');
      });

      it('should handle missing currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'fee-no-currency',
          type: 'FEE',
          subType: 'SERVICE_FEE',
          accountId: 'account-tfsa-123',
          currency: null,
          amount: 7.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('FEE:SERVICE_FEE:CAD');
      });

      it('should handle undefined currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'fee-undef-currency',
          type: 'FEE',
          subType: null,
          accountId: 'account-tfsa-123',
          amount: 4.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('FEE::CAD');
      });

      it('should handle all fields missing with appropriate fallbacks', () => {
        setupMockAccounts([]);

        const transaction = {
          externalCanonicalId: 'fee-all-missing',
          type: 'FEE',
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Financial Fees');
        expect(result.merchant).toBe('Fee (Unknown Account)');
        expect(result.originalStatement).toBe('FEE::CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should handle USD currency correctly', () => {
        const transaction = {
          externalCanonicalId: 'fee-usd',
          type: 'FEE',
          subType: 'SERVICE_FEE',
          accountId: 'account-tfsa-123',
          currency: 'USD',
          amount: 20.0,
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('FEE:SERVICE_FEE:USD');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'fee-no-mapping',
          type: 'FEE',
          subType: 'SERVICE_FEE',
          accountId: 'account-tfsa-123',
          currency: 'CAD',
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'fee-notes',
          type: 'FEE',
          subType: 'SERVICE_FEE',
          accountId: 'account-tfsa-123',
          currency: 'CAD',
        };

        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_FEE_TRANSACTION_RULES.find((r) => r.id === 'fee');

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
        expect(INVESTMENT_FEE_TRANSACTION_RULES.length).toBe(1);
      });

      it('should have unique rule ID', () => {
        const ids = INVESTMENT_FEE_TRANSACTION_RULES.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });
    });
  });

  describe('INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES', () => {
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
      setupMockAccounts([{ id: 'account-tfsa-123', nickname: 'Wealthsimple TFSA' }]);
    });

    describe('REIMBURSEMENT rule matching', () => {
      it('should match transactions with type REIMBURSEMENT', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-123',
          type: 'REIMBURSEMENT',
          subType: 'TRANSFER_FEE_REBATE',
          amount: 150.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match REIMBURSEMENT with any subType', () => {
        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');

        expect(rule.match({ type: 'REIMBURSEMENT', subType: 'TRANSFER_FEE_REBATE' })).toBe(true);
        expect(rule.match({ type: 'REIMBURSEMENT', subType: 'FEE_REBATE' })).toBe(true);
        expect(rule.match({ type: 'REIMBURSEMENT', subType: null })).toBe(true);
        expect(rule.match({ type: 'REIMBURSEMENT', subType: undefined })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');

        expect(rule.match({ type: 'REFUND', subType: 'REIMBURSEMENT' })).toBe(false);
        expect(rule.match({ type: 'DEPOSIT', subType: 'TRANSFER_FEE_REBATE' })).toBe(false);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(false);
      });
    });

    describe('REIMBURSEMENT transaction processing with subType and assetSymbol', () => {
      it('should process REIMBURSEMENT with subType and assetSymbol correctly', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-transfer-fee',
          type: 'REIMBURSEMENT',
          subType: 'TRANSFER_FEE_REBATE',
          assetSymbol: 'VFV',
          accountId: 'account-tfsa-123',
          amount: 150.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Reimbursement');
        expect(result.merchant).toBe('Transfer fee rebate for VFV (CAD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT:TRANSFER_FEE_REBATE:VFV:CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process REIMBURSEMENT with subType FEE_REBATE correctly', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-fee',
          type: 'REIMBURSEMENT',
          subType: 'FEE_REBATE',
          assetSymbol: 'XAW',
          accountId: 'account-tfsa-123',
          amount: 50.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Reimbursement');
        expect(result.merchant).toBe('Fee rebate for XAW (CAD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT:FEE_REBATE:XAW:CAD');
      });

      it('should skip "for {asset}" when assetSymbol is CAD', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-cad-asset',
          type: 'REIMBURSEMENT',
          subType: 'TRANSFER_FEE_REBATE',
          assetSymbol: 'CAD',
          accountId: 'account-tfsa-123',
          amount: 100.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Transfer fee rebate (CAD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT:TRANSFER_FEE_REBATE:CAD:CAD');
      });

      it('should skip "for {asset}" when assetSymbol is USD', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-usd-asset',
          type: 'REIMBURSEMENT',
          subType: 'FEE_REBATE',
          assetSymbol: 'USD',
          accountId: 'account-tfsa-123',
          amount: 75.0,
          currency: 'USD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Fee rebate (USD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT:FEE_REBATE:USD:USD');
      });
    });

    describe('REIMBURSEMENT transaction processing without subType', () => {
      it('should process REIMBURSEMENT with null subType and assetSymbol correctly', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-null-subtype',
          type: 'REIMBURSEMENT',
          subType: null,
          assetSymbol: 'AAPL',
          accountId: 'account-tfsa-123',
          amount: 100.0,
          currency: 'USD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Reimbursement');
        expect(result.merchant).toBe('Reimbursement for AAPL (USD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT::AAPL:USD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process REIMBURSEMENT without subType or assetSymbol correctly', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-minimal',
          type: 'REIMBURSEMENT',
          subType: null,
          assetSymbol: null,
          accountId: 'account-tfsa-123',
          amount: 80.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Reimbursement');
        expect(result.merchant).toBe('Reimbursement (CAD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT:::CAD');
      });
    });

    describe('REIMBURSEMENT edge cases', () => {
      it('should handle missing assetSymbol with empty string in originalStatement', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-no-symbol',
          type: 'REIMBURSEMENT',
          subType: 'TRANSFER_FEE_REBATE',
          assetSymbol: null,
          accountId: 'account-tfsa-123',
          amount: 50.0,
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Reimbursement');
        expect(result.merchant).toBe('Transfer fee rebate (CAD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT:TRANSFER_FEE_REBATE::CAD');
      });

      it('should handle all fields missing with appropriate fallbacks', () => {
        setupMockAccounts([]);

        const transaction = {
          externalCanonicalId: 'reimbursement-all-missing',
          type: 'REIMBURSEMENT',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Reimbursement');
        expect(result.merchant).toBe('Reimbursement (CAD)');
        expect(result.originalStatement).toBe('REIMBURSEMENT:::CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-no-mapping',
          type: 'REIMBURSEMENT',
          subType: 'TRANSFER_FEE_REBATE',
          assetSymbol: 'VFV',
          accountId: 'account-tfsa-123',
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'reimbursement-notes',
          type: 'REIMBURSEMENT',
          subType: 'TRANSFER_FEE_REBATE',
          assetSymbol: 'VFV',
          accountId: 'account-tfsa-123',
          currency: 'CAD',
        };

        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.find((r) => r.id === 'reimbursement');

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
        expect(INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.length).toBe(1);
      });

      it('should have unique rule ID', () => {
        const ids = INVESTMENT_REIMBURSEMENT_TRANSACTION_RULES.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });
    });
  });

  describe('INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES', () => {
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
      setupMockAccounts([{ id: 'account-tfsa-123', nickname: 'Wealthsimple TFSA' }]);
    });

    describe('NON_RESIDENT_TAX rule matching', () => {
      it('should match transactions with type NON_RESIDENT_TAX', () => {
        const transaction = {
          externalCanonicalId: 'nrt-123',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: 'MSFT',
          amount: 3.75,
          currency: 'USD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        expect(rule.match(transaction)).toBe(true);
      });

      it('should match NON_RESIDENT_TAX with any subType', () => {
        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');

        expect(rule.match({ type: 'NON_RESIDENT_TAX', subType: null })).toBe(true);
        expect(rule.match({ type: 'NON_RESIDENT_TAX', subType: undefined })).toBe(true);
        expect(rule.match({ type: 'NON_RESIDENT_TAX', subType: 'SOME_SUBTYPE' })).toBe(true);
      });

      it('should not match transactions with different type', () => {
        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');

        expect(rule.match({ type: 'DIVIDEND', subType: null })).toBe(false);
        expect(rule.match({ type: 'FEE', subType: 'NON_RESIDENT_TAX' })).toBe(false);
        expect(rule.match({ type: 'INTEREST', subType: null })).toBe(false);
        expect(rule.match({ type: 'TAX', subType: null })).toBe(false);
      });
    });

    describe('NON_RESIDENT_TAX transaction processing', () => {
      it('should process NON_RESIDENT_TAX with all fields correctly', () => {
        const transaction = {
          externalCanonicalId: 'nrt-msft-123',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: 'MSFT',
          accountId: 'account-tfsa-123',
          amount: 3.75,
          currency: 'USD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('Non-Resident Tax for MSFT');
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX::MSFT:USD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should process NON_RESIDENT_TAX with CAD currency correctly', () => {
        const transaction = {
          externalCanonicalId: 'nrt-cad-123',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: 'VFV',
          accountId: 'account-tfsa-123',
          amount: 5.25,
          currency: 'CAD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('Non-Resident Tax for VFV');
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX::VFV:CAD');
      });

      it('should process NON_RESIDENT_TAX with subType correctly', () => {
        const transaction = {
          externalCanonicalId: 'nrt-subtype-123',
          type: 'NON_RESIDENT_TAX',
          subType: 'DIVIDEND_WITHHOLDING',
          assetSymbol: 'AAPL',
          accountId: 'account-tfsa-123',
          amount: 2.50,
          currency: 'USD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('Non-Resident Tax for AAPL');
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX:DIVIDEND_WITHHOLDING:AAPL:USD');
      });
    });

    describe('NON_RESIDENT_TAX edge cases', () => {
      it('should handle missing assetSymbol', () => {
        const transaction = {
          externalCanonicalId: 'nrt-no-symbol',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: null,
          accountId: 'account-tfsa-123',
          amount: 1.00,
          currency: 'USD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('Non-Resident Tax');
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX:::USD');
      });

      it('should handle empty string assetSymbol', () => {
        const transaction = {
          externalCanonicalId: 'nrt-empty-symbol',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: '',
          accountId: 'account-tfsa-123',
          amount: 2.00,
          currency: 'CAD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Non-Resident Tax');
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX:::CAD');
      });

      it('should handle undefined assetSymbol', () => {
        const transaction = {
          externalCanonicalId: 'nrt-undef-symbol',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          accountId: 'account-tfsa-123',
          amount: 3.00,
          currency: 'USD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.merchant).toBe('Non-Resident Tax');
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX:::USD');
      });

      it('should handle missing currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'nrt-no-currency',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: 'GOOGL',
          accountId: 'account-tfsa-123',
          amount: 4.50,
          currency: null,
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX::GOOGL:CAD');
      });

      it('should handle undefined currency with CAD fallback', () => {
        const transaction = {
          externalCanonicalId: 'nrt-undef-currency',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: 'TSLA',
          accountId: 'account-tfsa-123',
          amount: 1.25,
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX::TSLA:CAD');
      });

      it('should handle all fields missing with appropriate fallbacks', () => {
        setupMockAccounts([]);

        const transaction = {
          externalCanonicalId: 'nrt-all-missing',
          type: 'NON_RESIDENT_TAX',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.category).toBe('Dividends & Capital Gains');
        expect(result.merchant).toBe('Non-Resident Tax');
        expect(result.originalStatement).toBe('NON_RESIDENT_TAX:::CAD');
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });

      it('should not set needsCategoryMapping flag (auto-categorized)', () => {
        const transaction = {
          externalCanonicalId: 'nrt-no-mapping',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: 'NVDA',
          currency: 'USD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.needsCategoryMapping).toBeUndefined();
      });

      it('should have empty notes and technicalDetails', () => {
        const transaction = {
          externalCanonicalId: 'nrt-notes',
          type: 'NON_RESIDENT_TAX',
          subType: null,
          assetSymbol: 'AMD',
          currency: 'USD',
        };

        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');
        const result = rule.process(transaction);

        expect(result).not.toBeNull();
        expect(result.notes).toBe('');
        expect(result.technicalDetails).toBe('');
      });
    });

    describe('Rule structure', () => {
      it('should have required properties', () => {
        const rule = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.find((r) => r.id === 'non-resident-tax');

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
        expect(INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.length).toBe(1);
      });

      it('should have unique rule ID', () => {
        const ids = INVESTMENT_NON_RESIDENT_TAX_TRANSACTION_RULES.map((r) => r.id);
        const uniqueIds = [...new Set(ids)];
        expect(ids.length).toBe(uniqueIds.length);
      });
    });
  });
});
