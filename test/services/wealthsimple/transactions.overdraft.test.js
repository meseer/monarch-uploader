/**
 * Tests for Wealthsimple OVERDRAFT_TRANSFER transactions
 *
 * Overdraft protection moves money from a linked account (e.g. a Portfolio Line
 * of Credit) into a Cash account that went negative. Wealthsimple reports it as
 * two legs sharing one externalCanonicalId:
 * - OVERDRAFT_TRANSFER/DESTINATION on the Cash account
 * - OVERDRAFT_TRANSFER/SOURCE on the funding (PLOC) account
 */

import {
  CASH_TRANSACTION_RULES,
  applyTransactionRule,
  hasRuleForTransaction,
} from '../../../src/services/wealthsimple/transactionRules';
import { fetchAndProcessLineOfCreditTransactions } from '../../../src/services/wealthsimple/transactions';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import { showManualTransactionCategorization } from '../../../src/ui/components/categorySelector';
import { STORAGE } from '../../../src/core/config';

jest.mock('../../../src/api/wealthsimple');
jest.mock('../../../src/api/monarch');
jest.mock('../../../src/mappers/category');
jest.mock('../../../src/ui/toast', () => ({
  show: jest.fn(),
}));
jest.mock('../../../src/ui/components/categorySelector', () => ({
  showMonarchCategorySelector: jest.fn(),
  showManualTransactionCategorization: jest.fn(),
}));

const CASH_ID = 'ca-cash-msb-iusfagkx';
const PLOC_ID = 'non-registered-BkAXsS7nNg';

const baseLeg = {
  amount: '7573.57',
  currency: 'CAD',
  externalCanonicalId: 'funding_intent-r5cEshMwIg7MJaAWxmX4dvzcV2Y',
  groupId: 'funding_intent-r5cEshMwIg7MJaAWxmX4dvzcV2Y_overdraft',
  occurredAt: '2026-09-29T07:59:59.999000+00:00',
  status: 'completed',
  type: 'OVERDRAFT_TRANSFER',
  unifiedStatus: 'COMPLETED',
};

const cashLeg = {
  ...baseLeg,
  accountId: CASH_ID,
  amountSign: 'positive',
  canonicalId: `funding_intent-r5cEshMwIg7MJaAWxmX4dvzcV2Y_overdraft-${CASH_ID}`,
  opposingAccountId: PLOC_ID,
  subType: 'DESTINATION',
};

const plocLeg = {
  ...baseLeg,
  accountId: PLOC_ID,
  amountSign: 'negative',
  canonicalId: `funding_intent-r5cEshMwIg7MJaAWxmX4dvzcV2Y_overdraft-${PLOC_ID}`,
  opposingAccountId: CASH_ID,
  subType: 'SOURCE',
};

beforeEach(() => {
  jest.clearAllMocks();
  global.GM_getValue = jest.fn((key, defaultValue) => {
    if (key === STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST) {
      return JSON.stringify([
        { wealthsimpleAccount: { id: CASH_ID, nickname: 'Chequing' } },
        { wealthsimpleAccount: { id: PLOC_ID, nickname: 'PLOC' } },
      ]);
    }
    return defaultValue;
  });
  wealthsimpleApi.fetchSpendTransactions = jest.fn().mockResolvedValue(new Map());
});

describe('Wealthsimple OVERDRAFT_TRANSFER', () => {
  describe('Cash account rule (DESTINATION leg)', () => {
    const rule = () => CASH_TRANSACTION_RULES.find((r) => r.id === 'overdraft-transfer');

    it('matches OVERDRAFT_TRANSFER/DESTINATION', () => {
      expect(rule().match(cashLeg)).toBe(true);
      expect(hasRuleForTransaction('OVERDRAFT_TRANSFER', 'DESTINATION')).toBe(true);
    });

    it('does not match other subtypes or types', () => {
      expect(rule().match(plocLeg)).toBe(false);
      expect(rule().match({ ...cashLeg, type: 'INTERNAL_TRANSFER' })).toBe(false);
    });

    it('categorizes as Transfer with an overdraft protection merchant', () => {
      const result = applyTransactionRule(cashLeg);

      expect(result).toEqual({
        category: 'Transfer',
        merchant: 'Overdraft Protection: Chequing ← PLOC',
        originalStatement: 'OVERDRAFT_TRANSFER:DESTINATION:Overdraft Protection: Chequing ← PLOC',
        notes: '',
        technicalDetails: '',
        ruleId: 'overdraft-transfer',
      });
    });

    it('falls back to Unknown Account when an account is not stored', () => {
      const result = applyTransactionRule({ ...cashLeg, opposingAccountId: 'missing-account' });

      expect(result.merchant).toBe('Overdraft Protection: Chequing ← Unknown Account');
    });
  });

  describe('Line of Credit rule (SOURCE leg)', () => {
    const locAccount = {
      wealthsimpleAccount: { id: PLOC_ID, nickname: 'PLOC', type: 'PORTFOLIO_LINE_OF_CREDIT' },
    };

    it('auto-categorizes OVERDRAFT_TRANSFER/SOURCE as a Transfer without manual prompt', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([plocLeg]);

      const result = await fetchAndProcessLineOfCreditTransactions(locAccount, '2026-09-01', '2026-09-30');

      expect(showManualTransactionCategorization).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'funding_intent-r5cEshMwIg7MJaAWxmX4dvzcV2Y',
        merchant: 'Overdraft Protection: PLOC → Chequing',
        originalMerchant: 'OVERDRAFT_TRANSFER:SOURCE:Overdraft Protection: PLOC → Chequing',
        amount: -7573.57,
        resolvedMonarchCategory: 'Transfer',
        ruleId: 'loc-overdraft-transfer',
        isPending: false,
      });
    });

    it('still prompts for an unrecognized OVERDRAFT_TRANSFER subtype on the LOC', async () => {
      wealthsimpleApi.fetchTransactions.mockResolvedValue([{ ...plocLeg, subType: 'DESTINATION' }]);
      showManualTransactionCategorization.mockImplementation((tx, resolve) => {
        resolve({ merchant: 'Manual', category: { name: 'Transfer' } });
      });

      const result = await fetchAndProcessLineOfCreditTransactions(locAccount, '2026-09-01', '2026-09-30');

      expect(showManualTransactionCategorization).toHaveBeenCalledTimes(1);
      expect(result[0].ruleId).toBe('manual');
    });
  });
});
