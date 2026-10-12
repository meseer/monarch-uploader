/**
 * Tests for Wealthsimple reconciliation of prepaid card purchases on CASH
 * accounts in the newer `PREPAID_CARD` / `PURCHASE` shape.
 *
 * These read pending/settled state from the `status` field (like credit cards
 * and the legacy `SPEND` / `PREPAID` shape). Unlike the legacy shape they are
 * not enriched: FetchSpendTransactions returns no details for their IDs.
 *
 * Kept in its own file because transactionsReconciliation.test.js is already
 * at the 1,500-line limit.
 */

import { reconcileWealthsimpleFetchedPending } from '../../../src/services/wealthsimple/transactionsReconciliation';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
  formatDate: jest.fn((d) => d.toISOString().split('T')[0]),
  formatAmount: (amount) => {
    if (amount === null || amount === undefined || isNaN(Number(amount))) return '0';
    return parseFloat(String(amount)).toString().replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  },
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getTagByName: jest.fn(),
    getTransactionsList: jest.fn(),
    updateTransaction: jest.fn(),
    setTransactionTags: jest.fn(),
    deleteTransaction: jest.fn(),
  },
}));

jest.mock('../../../src/api/wealthsimple', () => ({
  __esModule: true,
  default: {
    fetchCreditCardActivity: jest.fn(),
    fetchSpendTransactions: jest.fn(),
  },
}));

jest.mock('../../../src/mappers/category', () => ({
  resolveCategoryForTransaction: jest.fn(),
  getCategoryMappings: jest.fn(() => ({})),
}));

jest.mock('../../../src/services/common/pendingReconciliation', () => ({
  ...jest.requireActual('../../../src/services/common/pendingReconciliation'),
  fetchMonarchPendingTransactions: jest.fn(),
}));

global.GM_getValue = jest.fn(() => '[]');

const mockMonarchApi = require('../../../src/api/monarch').default;
const mockWealthsimpleApi = require('../../../src/api/wealthsimple').default;

// ── Fixtures ────────────────────────────────────────────────

const ACCOUNT_ID = 'ca-cash-msb-qiVT16TVQQ';
const WS_PENDING_ID = 'card-activity-00000000527029370638-VI-00-0356283806058987-49RS0W';
const WS_SETTLED_ID = `${WS_PENDING_ID}-0tmrndzcb85c`;

const pendingTag = { id: 'tag-pending', name: 'Pending' };

const buildPrepaidCardTx = (overrides = {}) => ({
  accountId: ACCOUNT_ID,
  externalCanonicalId: WS_SETTLED_ID,
  type: 'PREPAID_CARD',
  subType: 'PURCHASE',
  status: 'settled',
  unifiedStatus: 'COMPLETED',
  amount: '-18.21',
  amountSign: 'negative',
  currency: 'CAD',
  spendMerchant: "MCDONALD'S #10821 MYIJICD",
  occurredAt: '2026-10-10T22:23:25.000000+00:00',
  ...overrides,
});

const buildPendingMonarchTx = (id) => ({
  id,
  amount: -18.21,
  date: '2026-10-10',
  notes: `ws-tx:${WS_PENDING_ID}`,
  tags: [{ id: 'tag-pending', name: 'Pending' }],
  ownedByUser: { id: 'user-1' },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockMonarchApi.updateTransaction.mockResolvedValue({});
  mockMonarchApi.setTransactionTags.mockResolvedValue({});
  mockMonarchApi.deleteTransaction.mockResolvedValue(true);
  mockMonarchApi.getTagByName.mockResolvedValue(null);
  mockWealthsimpleApi.fetchSpendTransactions.mockResolvedValue(new Map());
});

// ── Tests ───────────────────────────────────────────────────

describe('reconcileWealthsimpleFetchedPending — PREPAID_CARD/PURCHASE', () => {
  it('settles a pending purchase once its status is settled', async () => {
    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [buildPendingMonarchTx('mtx-settle')],
      [buildPrepaidCardTx()],
      'CASH',
    );

    expect(result.settled).toBe(1);
    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith('mtx-settle', []);
  });

  it('leaves a purchase that is still authorized pending, even when unifiedStatus is COMPLETED', async () => {
    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [buildPendingMonarchTx('mtx-authorized')],
      [buildPrepaidCardTx({ externalCanonicalId: WS_PENDING_ID, status: 'authorized' })],
      'CASH',
    );

    expect(result.settled).toBe(0);
    expect(mockMonarchApi.setTransactionTags).not.toHaveBeenCalled();
    expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('does not request spend details on settle (FetchSpendTransactions returns none for this type)', async () => {
    await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [buildPendingMonarchTx('mtx-no-enrichment')],
      [buildPrepaidCardTx()],
      'CASH',
    );

    expect(mockWealthsimpleApi.fetchSpendTransactions).not.toHaveBeenCalled();
  });
});
