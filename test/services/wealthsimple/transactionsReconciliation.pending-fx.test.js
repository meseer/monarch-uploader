/**
 * Tests for Wealthsimple reconciliation — carry-over of FX data captured while
 * the transaction was still pending.
 *
 * Wealthsimple populates the FX fields inconsistently: some foreign card
 * authorizations already carry `originalAmount` / `originalCurrency` /
 * `foreignExchangeRate` before they settle, so the pending upload writes both an
 * FX note and a currency tag. Settlement must then:
 * - keep the currency tag (removing only "Pending") without duplicating it
 * - refresh the FX note in place rather than appending a second copy
 * - preserve any memo the user typed while the transaction was pending
 *
 * Split out of transactionsReconciliation.test.js to stay within the project
 * file-size limit.
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
    fetchExtendedOrder: jest.fn(),
    fetchActivityByOrdersServiceOrderId: jest.fn(),
    fetchCryptoOrder: jest.fn(),
    fetchCorporateActionChildActivities: jest.fn(),
    fetchShortOptionPositionExpiryDetail: jest.fn(),
    fetchSecurity: jest.fn(),
    fetchCreditCardActivity: jest.fn(),
    fetchSpendTransactions: jest.fn(),
  },
}));

// Mock merchant mapper to avoid deep dependency chain (integrationCapabilities → config)
jest.mock('../../../src/mappers/merchant', () => ({
  applyMerchantMapping: jest.fn((name) => name),
}));

jest.mock('../../../src/mappers/category', () => ({
  resolveCategoryForTransaction: jest.fn(),
  getCategoryMappings: jest.fn(() => ({})),
}));

// The pure computeSettledTagIds helper keeps its real implementation so the
// settle path exercises the production tag logic.
jest.mock('../../../src/services/common/pendingReconciliation', () => ({
  ...jest.requireActual('../../../src/services/common/pendingReconciliation'),
  fetchMonarchPendingTransactions: jest.fn(),
}));

global.GM_getValue = jest.fn(() => '[]');

const mockMonarchApi = require('../../../src/api/monarch').default;
const mockWealthsimpleApi = require('../../../src/api/wealthsimple').default;

// ── Fixtures ────────────────────────────────────────────────

const WS_PENDING_ID = 'card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS';
const WS_SETTLED_ID = `${WS_PENDING_ID}-0tk4pfcsob83`;

const pendingTag = { id: 'tag-pending', name: 'Pending' };

/** The FX note the pending upload wrote (rate available before settlement) */
const PENDING_FX_NOTE = 'Amount: 29.29 EUR (rate: 1.610106)';

/**
 * The FX note expected after settlement. The rate is passed through verbatim —
 * it is never reformatted or rounded, so the trailing zeros WS sends survive.
 */
const SETTLED_FX_NOTE = 'Amount: 29.29 EUR (rate: 1.612500)';

/** Settled card activity — same currency, final rate and a confirmed reward */
const SETTLED_FOREIGN_ACTIVITY = {
  id: WS_SETTLED_ID,
  status: 'settled',
  isForeign: true,
  originalAmount: '-29.29',
  originalCurrency: 'EUR',
  foreignAmount: -29,
  foreignCurrency: 'EUR',
  foreignExchangeRate: '1.612500',
  hasReward: true,
  rewardAmount: '0.94',
  rewardRate: '0.02',
};

const buildSettledCardTx = () => ({
  externalCanonicalId: WS_SETTLED_ID,
  type: 'CREDIT_CARD',
  subType: 'PURCHASE',
  status: 'settled',
  amount: 47.16,
  amountSign: 'negative',
  spendMerchant: 'CAFE BERLIN',
  occurredAt: '2026-01-10T12:00:00Z',
});

/**
 * A Monarch transaction as it exists after the PENDING upload of a foreign card
 * purchase whose FX data was already available: it carries the "Pending" tag,
 * the currency tag, and the FX note followed by the ws-tx: marker.
 */
const buildPendingUploadedMonarchTx = (id, { notes, tags } = {}) => ({
  id,
  amount: -47.16,
  date: '2026-01-10',
  notes: notes ?? `${PENDING_FX_NOTE}\nws-tx:${WS_PENDING_ID}`,
  tags: tags ?? [
    { id: 'tag-pending', name: 'Pending' },
    { id: 'tag-eur', name: 'EUR' },
  ],
  ownedByUser: { id: 'user-1' },
});

/** Extract the notes value from the first updateTransaction call for an id */
const getUpdatedNotes = (monarchTxId) => {
  const call = mockMonarchApi.updateTransaction.mock.calls
    .find(([id, payload]) => id === monarchTxId && payload.notes !== undefined);
  return call ? call[1].notes : undefined;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMonarchApi.updateTransaction.mockResolvedValue({});
  mockMonarchApi.setTransactionTags.mockResolvedValue({});
  mockMonarchApi.deleteTransaction.mockResolvedValue(true);
  mockMonarchApi.getTagByName.mockResolvedValue({ id: 'tag-eur', name: 'EUR' });
  mockWealthsimpleApi.fetchCreditCardActivity.mockResolvedValue(SETTLED_FOREIGN_ACTIVITY);
});

// ── Tests ───────────────────────────────────────────────────

describe('reconcileWealthsimpleFetchedPending — FX data captured while pending', () => {
  it('keeps the currency tag applied at pending state without duplicating it', async () => {
    const monarchTx = buildPendingUploadedMonarchTx('mtx-carryover-tag');

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [monarchTx],
      [buildSettledCardTx()],
      'CREDIT_CARD',
    );

    expect(result.settled).toBe(1);
    // Only "Pending" is removed — EUR stays exactly once
    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith(
      'mtx-carryover-tag',
      ['tag-eur'],
    );
  });

  it('keeps the currency tag alongside a tag the user added while pending', async () => {
    const monarchTx = buildPendingUploadedMonarchTx('mtx-carryover-user-tag', {
      tags: [
        { id: 'tag-pending', name: 'Pending' },
        { id: 'tag-eur', name: 'EUR' },
        { id: 'tag-travel', name: 'Travel' },
      ],
    });

    await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [monarchTx],
      [buildSettledCardTx()],
      'CREDIT_CARD',
    );

    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith(
      'mtx-carryover-user-tag',
      ['tag-eur', 'tag-travel'],
    );
  });

  it('refreshes the FX note in place rather than appending a second copy', async () => {
    const monarchTx = buildPendingUploadedMonarchTx('mtx-carryover-note');

    await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [monarchTx],
      [buildSettledCardTx()],
      'CREDIT_CARD',
    );

    const notes = getUpdatedNotes('mtx-carryover-note');

    // The settled rate replaces the pending rate — exactly one "Amount:" line
    expect(notes).toContain(SETTLED_FX_NOTE);
    expect(notes).not.toContain('1.610106');
    expect(notes.match(/Amount:/g)).toHaveLength(1);
    // The reward, only confirmed at settlement, is added
    expect(notes).toContain('Rewards: 0.94 (rate: 2%)');
    // The ws-tx: marker is stripped once settled
    expect(notes).not.toContain('ws-tx:');
  });

  it('preserves a user memo added while pending alongside the refreshed FX note', async () => {
    const monarchTx = buildPendingUploadedMonarchTx('mtx-carryover-memo', {
      notes: `Dinner with the team\n${PENDING_FX_NOTE}\nws-tx:${WS_PENDING_ID}`,
    });

    await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [monarchTx],
      [buildSettledCardTx()],
      'CREDIT_CARD',
    );

    const notes = getUpdatedNotes('mtx-carryover-memo');

    expect(notes).toContain('Dinner with the team');
    expect(notes).toContain(SETTLED_FX_NOTE);
    expect(notes.match(/Amount:/g)).toHaveLength(1);
    // The user's memo stays ahead of the automated block
    expect(notes.indexOf('Dinner with the team')).toBeLessThan(notes.indexOf('Amount:'));
  });

  it('is idempotent when the settled values match the pending note exactly', async () => {
    // Same rate before and after settlement, and no reward — re-running must not
    // duplicate the automated line.
    mockWealthsimpleApi.fetchCreditCardActivity.mockResolvedValue({
      ...SETTLED_FOREIGN_ACTIVITY,
      foreignExchangeRate: '1.610106',
      hasReward: false,
    });

    const monarchTx = buildPendingUploadedMonarchTx('mtx-carryover-idempotent', {
      notes: `Team lunch\n${PENDING_FX_NOTE}\nws-tx:${WS_PENDING_ID}`,
    });

    await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [monarchTx],
      [buildSettledCardTx()],
      'CREDIT_CARD',
    );

    const notes = getUpdatedNotes('mtx-carryover-idempotent');

    expect(notes).toContain('Team lunch');
    expect(notes.match(/Amount:/g)).toHaveLength(1);
    expect(notes).toContain(PENDING_FX_NOTE);
  });

  it('keeps the pending FX note when the settled enrichment fetch fails', async () => {
    // Losing the enrichment must never lose the data already written — the
    // pending note is the best available information in that case.
    mockWealthsimpleApi.fetchCreditCardActivity.mockResolvedValue(null);

    const monarchTx = buildPendingUploadedMonarchTx('mtx-carryover-no-enrichment', {
      notes: `Client dinner\n${PENDING_FX_NOTE}\nws-tx:${WS_PENDING_ID}`,
    });

    const result = await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [monarchTx],
      [buildSettledCardTx()],
      'CREDIT_CARD',
    );

    expect(result.settled).toBe(1);

    const notes = getUpdatedNotes('mtx-carryover-no-enrichment');
    expect(notes).toContain('Client dinner');
    expect(notes).toContain(PENDING_FX_NOTE);

    // The currency tag applied while pending is still not dropped
    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith(
      'mtx-carryover-no-enrichment',
      ['tag-eur'],
    );
  });

  it('adds the currency tag at settle for a transaction that had no FX data while pending', async () => {
    // The other direction: WS did not populate the FX fields until settlement,
    // so the pending upload carried only the "Pending" tag.
    const monarchTx = buildPendingUploadedMonarchTx('mtx-late-fx', {
      notes: `ws-tx:${WS_PENDING_ID}`,
      tags: [{ id: 'tag-pending', name: 'Pending' }],
    });

    await reconcileWealthsimpleFetchedPending(
      pendingTag,
      [monarchTx],
      [buildSettledCardTx()],
      'CREDIT_CARD',
    );

    expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith(
      'mtx-late-fx',
      ['tag-eur'],
    );

    const notes = getUpdatedNotes('mtx-late-fx');
    expect(notes).toContain(SETTLED_FX_NOTE);
  });
});