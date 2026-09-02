/**
 * Tests for Wealthsimple account type mappings and capability sets
 *
 * Every Wealthsimple account type must be registered in several places for a
 * sync to behave correctly. These tests assert those registrations stay in
 * agreement so a newly added type cannot be half-wired.
 */

import {
  getMonarchAccountTypeMapping,
  getAccountTypeDisplayName,
} from '../../src/mappers/wealthsimple-account-types';
import {
  WEALTHSIMPLE_CASH_LIKE_TYPES,
  WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES,
  WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES,
  WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES,
} from '../../src/core/config';
import { isInvestmentAccount } from '../../src/services/wealthsimple/positions';

describe('Wealthsimple account type mappings', () => {
  describe('getMonarchAccountTypeMapping', () => {
    test('maps managed investment accounts to brokerage', () => {
      expect(getMonarchAccountTypeMapping('MANAGED_TFSA')).toEqual({ type: 'brokerage', subtype: 'tfsa' });
      expect(getMonarchAccountTypeMapping('MANAGED_RRSP')).toEqual({ type: 'brokerage', subtype: 'rrsp' });
      expect(getMonarchAccountTypeMapping('MANAGED_RESP')).toEqual({ type: 'brokerage', subtype: 'resp' });
      expect(getMonarchAccountTypeMapping('MANAGED_NON_REGISTERED')).toEqual({ type: 'brokerage', subtype: 'brokerage' });
    });

    test('maps self-directed investment accounts to brokerage', () => {
      expect(getMonarchAccountTypeMapping('SELF_DIRECTED_TFSA')).toEqual({ type: 'brokerage', subtype: 'tfsa' });
      expect(getMonarchAccountTypeMapping('SELF_DIRECTED_CRYPTO')).toEqual({ type: 'brokerage', subtype: 'cryptocurrency' });
    });

    test('maps cash accounts to depository checking', () => {
      expect(getMonarchAccountTypeMapping('CASH')).toEqual({ type: 'depository', subtype: 'checking' });
      expect(getMonarchAccountTypeMapping('CASH_USD')).toEqual({ type: 'depository', subtype: 'checking' });
      expect(getMonarchAccountTypeMapping('YOUTH_CASH')).toEqual({ type: 'depository', subtype: 'checking' });
    });

    test('maps credit cards and lines of credit', () => {
      expect(getMonarchAccountTypeMapping('CREDIT_CARD')).toEqual({ type: 'credit', subtype: 'credit_card' });
      expect(getMonarchAccountTypeMapping('PORTFOLIO_LINE_OF_CREDIT')).toEqual({ type: 'loan', subtype: 'line_of_credit' });
    });

    test('returns null for unknown account types', () => {
      expect(getMonarchAccountTypeMapping('SOME_FUTURE_TYPE')).toBeNull();
    });

    describe('SELF_DIRECTED_NON_REGISTERED_MARGIN', () => {
      test('has a Monarch mapping (regression: was missing)', () => {
        expect(getMonarchAccountTypeMapping('SELF_DIRECTED_NON_REGISTERED_MARGIN')).toEqual({
          type: 'brokerage',
          subtype: 'brokerage',
        });
      });

      test('has a display name (regression: fell back to the raw enum)', () => {
        expect(getAccountTypeDisplayName('SELF_DIRECTED_NON_REGISTERED_MARGIN'))
          .toBe('Self Directed Non-Registered Margin');
      });
    });

    describe('HISA_PORTFOLIO_NON_REGISTERED', () => {
      test('maps to depository savings, not brokerage', () => {
        expect(getMonarchAccountTypeMapping('HISA_PORTFOLIO_NON_REGISTERED')).toEqual({
          type: 'depository',
          subtype: 'savings',
        });
      });

      test('has the expected display name', () => {
        expect(getAccountTypeDisplayName('HISA_PORTFOLIO_NON_REGISTERED')).toBe('HISA Non-Registered');
      });
    });

    describe('YOUTH_CASH', () => {
      test('maps to depository checking, same as a regular CASH account', () => {
        expect(getMonarchAccountTypeMapping('YOUTH_CASH')).toEqual({
          type: 'depository',
          subtype: 'checking',
        });
      });

      test('has the expected display name', () => {
        expect(getAccountTypeDisplayName('YOUTH_CASH')).toBe('Youth Cash');
      });
    });
  });

  describe('getAccountTypeDisplayName', () => {
    test('returns friendly names for known types', () => {
      expect(getAccountTypeDisplayName('CREDIT_CARD')).toBe('Credit Card');
      expect(getAccountTypeDisplayName('CASH_USD')).toBe('Cash USD');
      expect(getAccountTypeDisplayName('YOUTH_CASH')).toBe('Youth Cash');
      expect(getAccountTypeDisplayName('MANAGED_RESP_FAMILY')).toBe('Managed Family RESP');
    });

    test('falls back to the raw type for unknown types', () => {
      expect(getAccountTypeDisplayName('SOME_FUTURE_TYPE')).toBe('SOME_FUTURE_TYPE');
    });
  });
});

describe('Wealthsimple account type capability sets', () => {
  describe('WEALTHSIMPLE_CASH_LIKE_TYPES', () => {
    test('contains the deposit-only account types', () => {
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('CASH')).toBe(true);
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('CASH_USD')).toBe(true);
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('YOUTH_CASH')).toBe(true);
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('HISA_PORTFOLIO_NON_REGISTERED')).toBe(true);
    });

    test('excludes credit, loan and investment types', () => {
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('CREDIT_CARD')).toBe(false);
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('PORTFOLIO_LINE_OF_CREDIT')).toBe(false);
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('MANAGED_TFSA')).toBe(false);
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('SELF_DIRECTED_TFSA')).toBe(false);
    });
  });

  describe('HISA_PORTFOLIO_NON_REGISTERED registration', () => {
    test('supports transaction upload', () => {
      expect(WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has('HISA_PORTFOLIO_NON_REGISTERED')).toBe(true);
    });

    test('supports pending reconciliation', () => {
      expect(WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES.has('HISA_PORTFOLIO_NON_REGISTERED')).toBe(true);
    });

    test('does NOT need balance reconstruction (balance comes from the API)', () => {
      expect(WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES.has('HISA_PORTFOLIO_NON_REGISTERED')).toBe(false);
    });

    test('is NOT an investment account (no holdings or cash sync steps)', () => {
      expect(isInvestmentAccount('HISA_PORTFOLIO_NON_REGISTERED')).toBe(false);
    });
  });

  describe('YOUTH_CASH registration', () => {
    test('is treated with cash-account semantics', () => {
      expect(WEALTHSIMPLE_CASH_LIKE_TYPES.has('YOUTH_CASH')).toBe(true);
    });

    test('supports transaction upload', () => {
      expect(WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has('YOUTH_CASH')).toBe(true);
    });

    test('supports pending reconciliation', () => {
      expect(WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES.has('YOUTH_CASH')).toBe(true);
    });

    test('does NOT need balance reconstruction (balance comes from the API)', () => {
      expect(WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES.has('YOUTH_CASH')).toBe(false);
    });

    test('is NOT an investment account (no holdings or cash sync steps)', () => {
      expect(isInvestmentAccount('YOUTH_CASH')).toBe(false);
    });
  });

  describe('SELF_DIRECTED_NON_REGISTERED_MARGIN registration', () => {
    test('supports transaction upload', () => {
      expect(WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has('SELF_DIRECTED_NON_REGISTERED_MARGIN')).toBe(true);
    });

    test('supports pending reconciliation', () => {
      expect(WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES.has('SELF_DIRECTED_NON_REGISTERED_MARGIN')).toBe(true);
    });

    test('is an investment account', () => {
      expect(isInvestmentAccount('SELF_DIRECTED_NON_REGISTERED_MARGIN')).toBe(true);
    });
  });

  describe('cross-set consistency', () => {
    test('every cash-like type supports transactions', () => {
      for (const type of WEALTHSIMPLE_CASH_LIKE_TYPES) {
        expect(WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(type)).toBe(true);
      }
    });

    test('every cash-like type supports pending reconciliation', () => {
      for (const type of WEALTHSIMPLE_CASH_LIKE_TYPES) {
        expect(WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES.has(type)).toBe(true);
      }
    });

    test('no cash-like type needs balance reconstruction', () => {
      for (const type of WEALTHSIMPLE_CASH_LIKE_TYPES) {
        expect(WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES.has(type)).toBe(false);
      }
    });

    test('no cash-like type is treated as an investment account', () => {
      for (const type of WEALTHSIMPLE_CASH_LIKE_TYPES) {
        expect(isInvestmentAccount(type)).toBe(false);
      }
    });

    test('every transaction-supported type has a Monarch type mapping', () => {
      for (const type of WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES) {
        expect(getMonarchAccountTypeMapping(type)).not.toBeNull();
      }
    });

    test('every transaction-supported type has an explicit display name', () => {
      for (const type of WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES) {
        // A missing entry falls back to returning the raw type unchanged
        expect(getAccountTypeDisplayName(type)).not.toBe(type);
      }
    });

    test('pending reconciliation types are a subset of transaction-supported types', () => {
      for (const type of WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES) {
        expect(WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES.has(type)).toBe(true);
      }
    });
  });
});