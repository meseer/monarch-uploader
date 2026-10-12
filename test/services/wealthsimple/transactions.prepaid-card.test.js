/**
 * Tests for Wealthsimple prepaid card purchases on CASH accounts.
 *
 * Wealthsimple reports debit-style card purchases in two shapes:
 * - `SPEND` / `PREPAID` — the original prepaid card
 * - `PREPAID_CARD` / `PURCHASE` — the newer prepaid card
 *
 * Both must be routed through the `spend-prepaid` rule (merchant from
 * `spendMerchant`, category via merchant mapping) and use the `status` field
 * for pending/settled state. Only the legacy shape is enriched via
 * FetchSpendTransactions — it returns no details for PREPAID_CARD IDs.
 *
 * Kept in its own file because transactions.cash.test.js is already at the
 * 1,500-line limit.
 */

import { fetchAndProcessCashTransactions } from '../../../src/services/wealthsimple/transactions';
import { applyTransactionRule } from '../../../src/services/wealthsimple/transactionRules';
import { isPrepaidCardSpend } from '../../../src/services/wealthsimple/transactionRulesHelpers';
import wealthsimpleApi from '../../../src/api/wealthsimple';
import monarchApi from '../../../src/api/monarch';
import { applyWealthsimpleCategoryMapping } from '../../../src/mappers/category';
import { showManualTransactionCategorization } from '../../../src/ui/components/categorySelector';

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

const YOUTH_CASH_ACCOUNT_ID = 'ca-cash-msb-qiVT16TVQQ';

const mockCashAccount = {
  wealthsimpleAccount: {
    id: YOUTH_CASH_ACCOUNT_ID,
    nickname: 'Youth Cash',
    type: 'CASH',
  },
};

/** Real PREPAID_CARD/PURCHASE activity shape from the Wealthsimple activity feed */
const buildPrepaidCardPurchase = (overrides = {}) => ({
  accountId: YOUTH_CASH_ACCOUNT_ID,
  amount: '-18.21',
  amountSign: 'negative',
  canonicalId: `card-transaction-00000000527029370638-VI-00-0tmrpc0vlgct-${YOUTH_CASH_ACCOUNT_ID}`,
  currency: 'CAD',
  externalCanonicalId: 'card-activity-00000000527029370638-VI-00-0356283806058987-49RS0W-0tmrndzcb85c',
  occurredAt: '2026-10-10T22:23:25.000000+00:00',
  spendMerchant: "MCDONALD'S #10821 MYIJICD",
  status: 'settled',
  subType: 'PURCHASE',
  type: 'PREPAID_CARD',
  unifiedStatus: 'COMPLETED',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  wealthsimpleApi.fetchSpendTransactions = jest.fn().mockResolvedValue(new Map());
  monarchApi.getCategoriesAndGroups.mockResolvedValue({ categories: [], categoryGroups: [] });
  applyWealthsimpleCategoryMapping.mockReturnValue('Restaurants & Bars');
});

describe('isPrepaidCardSpend', () => {
  it('matches the original SPEND/PREPAID shape', () => {
    expect(isPrepaidCardSpend({ type: 'SPEND', subType: 'PREPAID' })).toBe(true);
  });

  it('matches the new PREPAID_CARD/PURCHASE shape', () => {
    expect(isPrepaidCardSpend({ type: 'PREPAID_CARD', subType: 'PURCHASE' })).toBe(true);
  });

  it.each([
    ['PREPAID_CARD', 'PREPAID'],
    ['SPEND', 'PURCHASE'],
    ['CREDIT_CARD', 'PURCHASE'],
    ['DEPOSIT', 'E_TRANSFER'],
    [null, null],
    [undefined, undefined],
  ])('does not match %s/%s', (type, subType) => {
    expect(isPrepaidCardSpend({ type, subType })).toBe(false);
  });
});

describe('spend-prepaid rule — PREPAID_CARD/PURCHASE', () => {
  it('matches and takes the merchant from spendMerchant', () => {
    const result = applyTransactionRule(buildPrepaidCardPurchase());

    expect(result).not.toBeNull();
    expect(result.ruleId).toBe('spend-prepaid');
    expect(result.merchant).not.toBe('');
    expect(result.merchant).toBe("McDonald's");
    expect(result.originalStatement).toBe("PREPAID_CARD:PURCHASE:MCDONALD'S #10821 MYIJICD");
    expect(result.needsCategoryMapping).toBe(true);
    expect(result.categoryKey).toBe(result.merchant);
  });

  it('falls back to "Unknown Merchant" when spendMerchant is missing', () => {
    const result = applyTransactionRule(buildPrepaidCardPurchase({ spendMerchant: null }));

    expect(result.ruleId).toBe('spend-prepaid');
    expect(result.originalStatement).toBe('PREPAID_CARD:PURCHASE:Unknown Merchant');
  });
});

describe('fetchAndProcessCashTransactions — PREPAID_CARD/PURCHASE', () => {
  it('auto-categorizes via merchant mapping instead of manual categorization', async () => {
    wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPrepaidCardPurchase()]);

    const result = await fetchAndProcessCashTransactions(mockCashAccount, '2026-10-01', '2026-10-31');

    expect(showManualTransactionCategorization).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      ruleId: 'spend-prepaid',
      resolvedMonarchCategory: 'Restaurants & Bars',
      originalMerchant: "PREPAID_CARD:PURCHASE:MCDONALD'S #10821 MYIJICD",
      amount: -18.21,
      isPending: false,
    });
    expect(result[0].merchant).not.toBe('');
  });

  it('does not request spend details (FetchSpendTransactions returns none for this type)', async () => {
    wealthsimpleApi.fetchTransactions.mockResolvedValue([buildPrepaidCardPurchase()]);

    await fetchAndProcessCashTransactions(mockCashAccount, '2026-10-01', '2026-10-31');

    expect(wealthsimpleApi.fetchSpendTransactions).not.toHaveBeenCalled();
  });

  it('uses the status field to mark an authorized purchase as pending', async () => {
    wealthsimpleApi.fetchTransactions.mockResolvedValue([
      buildPrepaidCardPurchase({ status: 'authorized', unifiedStatus: 'COMPLETED' }),
    ]);

    const result = await fetchAndProcessCashTransactions(
      { ...mockCashAccount, includePendingTransactions: true },
      '2026-10-01',
      '2026-10-31',
    );

    expect(result).toHaveLength(1);
    expect(result[0].isPending).toBe(true);
  });

  it('excludes an authorized purchase when pending transactions are disabled', async () => {
    wealthsimpleApi.fetchTransactions.mockResolvedValue([
      buildPrepaidCardPurchase({ status: 'authorized', unifiedStatus: 'COMPLETED' }),
    ]);

    const result = await fetchAndProcessCashTransactions(
      { ...mockCashAccount, includePendingTransactions: false },
      '2026-10-01',
      '2026-10-31',
    );

    expect(result).toHaveLength(0);
  });

  it('excludes a rejected purchase', async () => {
    wealthsimpleApi.fetchTransactions.mockResolvedValue([
      buildPrepaidCardPurchase({ status: 'rejected', unifiedStatus: 'COMPLETED' }),
    ]);

    const result = await fetchAndProcessCashTransactions(mockCashAccount, '2026-10-01', '2026-10-31');

    expect(result).toHaveLength(0);
  });

  it('still processes legacy SPEND/PREPAID purchases', async () => {
    wealthsimpleApi.fetchTransactions.mockResolvedValue([
      buildPrepaidCardPurchase({ type: 'SPEND', subType: 'PREPAID', externalCanonicalId: 'spend-legacy-1' }),
    ]);

    const result = await fetchAndProcessCashTransactions(mockCashAccount, '2026-10-01', '2026-10-31');

    expect(showManualTransactionCategorization).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe('spend-prepaid');
  });
});
