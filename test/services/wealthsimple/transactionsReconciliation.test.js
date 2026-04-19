/**
 * Tests for Wealthsimple reconciliation:
 * - regenerateSettledNotes (notes regeneration via rules engine)
 * - reconcileWealthsimpleFetchedPending (Phase 2 settle flow)
 * - reconcilePendingTransactions (backward-compat wrapper)
 * - formatReconciliationMessage
 * - formatTransactionIdForNotes
 */

import {
  reconcileWealthsimpleFetchedPending,
  reconcilePendingTransactions,
  regenerateSettledNotes,
  formatReconciliationMessage,
  formatTransactionIdForNotes,
} from '../../../src/services/wealthsimple/transactionsReconciliation';

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

// Mock the shared Phase 1 for the convenience wrapper
jest.mock('../../../src/services/common/pendingReconciliation', () => ({
  fetchMonarchPendingTransactions: jest.fn(),
}));

// GM_getValue is mocked in test/setup.js, but override for getAccountNameById
global.GM_getValue = jest.fn(() => '[]');

const mockMonarchApi = require('../../../src/api/monarch').default;
const mockWealthsimpleApi = require('../../../src/api/wealthsimple').default;
const { fetchMonarchPendingTransactions } = require('../../../src/services/common/pendingReconciliation');

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────

const makeMonarchTx = (id, notes, overrides = {}) => ({
  id,
  amount: -25.0,
  notes,
  tags: [{ id: 'tag-pending', name: 'Pending' }],
  ownedByUser: { id: 'user-1' },
  ...overrides,
});

const makeWsTx = (externalCanonicalId, overrides = {}) => ({
  externalCanonicalId,
  amount: 25.0,
  amountSign: 'negative',
  status: 'settled',
  type: 'SPEND',
  subType: 'PURCHASE',
  ...overrides,
});

const pendingTag = { id: 'tag-pending', name: 'Pending' };

// ── regenerateSettledNotes ───────────────────────────────────

describe('regenerateSettledNotes', () => {
  it('regenerates notes for a settled DIY_BUY LIMIT_ORDER with extended order data', async () => {
    const wsTx = {
      externalCanonicalId: 'order-abc123',
      type: 'DIY_BUY',
      subType: 'LIMIT_ORDER',
      amount: 330,
      currency: 'USD',
      assetSymbol: 'VFV',
      amountSign: 'negative',
    };

    mockWealthsimpleApi.fetchExtendedOrder.mockResolvedValue({
      orderType: 'BUY',
      submittedQuantity: 100,
      filledQuantity: 22,
      averageFilledPrice: 15,
      filledTotalFee: 0,
      limitPrice: 15.5,
      timeInForce: 'GTC',
    });

    const notes = await regenerateSettledNotes(wsTx);

    expect(notes).not.toBeNull();
    expect(notes).toContain('Filled 22');
    expect(notes).toContain('USD$15');
    expect(notes).toContain('USD$330');
    expect(mockWealthsimpleApi.fetchExtendedOrder).toHaveBeenCalledWith('order-abc123');
  });

  it('regenerates notes for a settled DIY_BUY MARKET_ORDER', async () => {
    const wsTx = {
      externalCanonicalId: 'order-def456',
      type: 'DIY_BUY',
      subType: 'MARKET_ORDER',
      amount: 452.3,
      currency: 'CAD',
      assetSymbol: 'XEQT',
      amountSign: 'negative',
    };

    mockWealthsimpleApi.fetchExtendedOrder.mockResolvedValue({
      orderType: 'BUY',
      submittedQuantity: 10,
      filledQuantity: 10,
      averageFilledPrice: 45.23,
      filledTotalFee: 0,
    });

    const notes = await regenerateSettledNotes(wsTx);

    expect(notes).not.toBeNull();
    expect(notes).toContain('Filled 10');
    expect(notes).toContain('CAD$45.23');
    expect(notes).toContain('CAD$452.3');
  });

  it('generates minimal notes when enrichment API fails', async () => {
    const wsTx = {
      externalCanonicalId: 'order-fail',
      type: 'DIY_BUY',
      subType: 'LIMIT_ORDER',
      amount: 100,
      currency: 'CAD',
      assetSymbol: 'VFV',
      amountSign: 'negative',
    };

    mockWealthsimpleApi.fetchExtendedOrder.mockRejectedValue(new Error('API error'));

    const notes = await regenerateSettledNotes(wsTx);

    // Should still produce notes (minimal, without enrichment)
    expect(notes).not.toBeNull();
    expect(notes).toContain('VFV');
  });

  it('generates minimal notes when enrichment returns null', async () => {
    const wsTx = {
      externalCanonicalId: 'order-null',
      type: 'DIY_SELL',
      subType: 'MARKET_ORDER',
      amount: 500,
      currency: 'USD',
      assetSymbol: 'AAPL',
      amountSign: 'positive',
    };

    mockWealthsimpleApi.fetchExtendedOrder.mockResolvedValue(null);

    const notes = await regenerateSettledNotes(wsTx);

    expect(notes).not.toBeNull();
    expect(notes).toContain('AAPL');
    expect(notes).toContain('USD$500');
  });

  it('regenerates dividend notes with amount data', async () => {
    const wsTx = {
      externalCanonicalId: 'div-123',
      canonicalId: 'can-123',
      type: 'DIVIDEND',
      subType: null,
      amount: 12.50,
      currency: 'CAD',
      assetSymbol: 'VFV',
      assetQuantity: 100,
      amountSign: 'positive',
    };

    const notes = await regenerateSettledNotes(wsTx);

    expect(notes).not.toBeNull();
    expect(notes).toContain('Dividend on VFV');
    expect(notes).toContain('CAD$12.5');
    // No enrichment API should be called for dividends
    expect(mockWealthsimpleApi.fetchExtendedOrder).not.toHaveBeenCalled();
  });

  it('returns null for transaction types with no notes (e.g., FEE)', async () => {
    const wsTx = {
      externalCanonicalId: 'fee-123',
      type: 'FEE',
      subType: 'SERVICE_FEE',
      amount: 5.0,
      currency: 'CAD',
      amountSign: 'negative',
    };

    const notes = await regenerateSettledNotes(wsTx);

    // FEE rule produces empty notes
    expect(notes).toBeNull();
  });

  it('returns null for unmatched transaction types', async () => {
    const wsTx = {
      externalCanonicalId: 'unknown-123',
      type: 'SOME_UNKNOWN_TYPE',
      subType: null,
      amount: 100,
      currency: 'CAD',
    };

    const notes = await regenerateSettledNotes(wsTx);

    expect(notes).toBeNull();
  });

  it('fetches managed order enrichment for MANAGED_BUY', async () => {
    const wsTx = {
      externalCanonicalId: 'order-managed-1',
      accountId: 'acct-123',
      type: 'MANAGED_BUY',
      subType: null,
      amount: 100,
      currency: 'CAD',
      assetSymbol: 'XEQT',
      assetName: 'iShares Core Equity ETF Portfolio',
      amountSign: 'negative',
    };

    mockWealthsimpleApi.fetchActivityByOrdersServiceOrderId.mockResolvedValue({
      quantity: 5,
      marketPrice: { amount: 20, currency: 'CAD' },
    });

    const notes = await regenerateSettledNotes(wsTx);

    expect(notes).not.toBeNull();
    expect(notes).toContain('XEQT');
    expect(mockWealthsimpleApi.fetchActivityByOrdersServiceOrderId).toHaveBeenCalledWith('acct-123', 'order-managed-1');
  });

  it('fetches crypto order enrichment for CRYPTO_BUY', async () => {
    const wsTx = {
      externalCanonicalId: 'order-crypto-1',
      type: 'CRYPTO_BUY',
      subType: 'MARKET_ORDER',
      amount: 50,
      currency: 'CAD',
      assetSymbol: 'BTC',
      amountSign: 'negative',
    };

    mockWealthsimpleApi.fetchCryptoOrder.mockResolvedValue({
      currency: 'CAD',
      quantity: 0.001,
      executedQuantity: 0.001,
      price: 50000,
      fee: 1.5,
      swapFee: 0,
      totalCost: 51.5,
      isCryptoOrderData: true,
    });

    const notes = await regenerateSettledNotes(wsTx);

    expect(notes).not.toBeNull();
    expect(notes).toContain('BTC');
    expect(mockWealthsimpleApi.fetchCryptoOrder).toHaveBeenCalledWith('order-crypto-1');
  });
});

// ── reconcileWealthsimpleFetchedPending (Phase 2) ───────────

describe('reconcileWealthsimpleFetchedPending', () => {
  describe('settled transactions with notes regeneration', () => {
    it('updates notes with settled fill data for a LIMIT_BUY order', async () => {
      const monarchTx = makeMonarchTx(
        'mtx-1',
        'Limit order Buy 100 VFV @ 15.50 Limit GTC\nFilled 0 @ USD$0, fees: USD$0\nTotal USD$0\nws-tx:order-abc123',
        { amount: 0 },
      );

      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const wsTx = makeWsTx('order-abc123', {
        type: 'DIY_BUY',
        subType: 'LIMIT_ORDER',
        status: null,
        unifiedStatus: 'COMPLETED',
        amount: 330,
        currency: 'USD',
        assetSymbol: 'VFV',
        amountSign: 'negative',
      });

      mockWealthsimpleApi.fetchExtendedOrder.mockResolvedValue({
        orderType: 'BUY',
        submittedQuantity: 100,
        filledQuantity: 22,
        averageFilledPrice: 15,
        filledTotalFee: 0,
        limitPrice: 15.5,
        timeInForce: 'GTC',
      });

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [monarchTx],
        [wsTx],
        'SELF_DIRECTED_TFSA',
      );

      expect(result.settled).toBe(1);

      const notesUpdateCall = mockMonarchApi.updateTransaction.mock.calls[0];
      expect(notesUpdateCall[0]).toBe('mtx-1');
      const updatedNotes = notesUpdateCall[1].notes;
      expect(updatedNotes).toContain('Filled 22');
      expect(updatedNotes).toContain('USD$15');
      expect(updatedNotes).toContain('USD$330');
      expect(updatedNotes).not.toContain('ws-tx:');
    });

    it('does not update notes when regenerated notes match existing', async () => {
      const existingNotes = 'Dividend on VFV: CAD$12.50\nHoldings on record date: 100 shares';
      const monarchTx = makeMonarchTx(
        'mtx-2',
        `${existingNotes}\nws-tx:div-123`,
        { amount: 12.5 },
      );

      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const wsTx = makeWsTx('div-123', {
        type: 'DIVIDEND',
        subType: null,
        status: null,
        unifiedStatus: 'COMPLETED',
        amount: 12.5,
        currency: 'CAD',
        assetSymbol: 'VFV',
        assetQuantity: 100,
        amountSign: 'positive',
      });

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [monarchTx],
        [wsTx],
        'SELF_DIRECTED_TFSA',
      );

      expect(result.settled).toBe(1);

      const notesUpdateCall = mockMonarchApi.updateTransaction.mock.calls[0];
      const updatedNotes = notesUpdateCall[1].notes;
      expect(updatedNotes).toContain('Dividend on VFV');
      expect(updatedNotes).toContain('CAD$12.5');
    });

    it('handles notes regeneration failure gracefully', async () => {
      const monarchTx = makeMonarchTx(
        'mtx-3',
        'Some pending notes\nws-tx:credit-transaction-xyz',
        { amount: -25 },
      );

      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const wsTx = makeWsTx('credit-transaction-xyz', {
        status: 'settled',
        amount: 25,
        amountSign: 'negative',
      });

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [monarchTx],
        [wsTx],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(1);
      expect(result.failed).toBe(0);
    });
  });

  describe('basic reconciliation flow', () => {
    it('settles a credit card transaction', async () => {
      mockMonarchApi.updateTransaction.mockResolvedValue({});
      mockMonarchApi.setTransactionTags.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [makeWsTx('credit-transaction-abc123', { status: 'settled', amount: 25, amountSign: 'negative' })],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(1);
      expect(result.cancelled).toBe(0);
      expect(mockMonarchApi.setTransactionTags).toHaveBeenCalledWith('mtx-1', []);
    });

    it('deletes when WS transaction not found', async () => {
      mockMonarchApi.deleteTransaction.mockResolvedValue({});

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [],
        'CREDIT_CARD',
      );

      expect(result.cancelled).toBe(1);
      expect(mockMonarchApi.deleteTransaction).toHaveBeenCalledWith('mtx-1');
    });

    it('takes no action for transactions still pending', async () => {
      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [makeWsTx('credit-transaction-abc123', { status: 'authorized' })],
        'CREDIT_CARD',
      );

      expect(result.settled).toBe(0);
      expect(result.cancelled).toBe(0);
      expect(mockMonarchApi.deleteTransaction).not.toHaveBeenCalled();
      expect(mockMonarchApi.updateTransaction).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('counts failed on per-transaction errors', async () => {
      mockMonarchApi.deleteTransaction.mockRejectedValue(new Error('API error'));

      const result = await reconcileWealthsimpleFetchedPending(
        pendingTag,
        [makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123')],
        [],
        'CREDIT_CARD',
      );

      expect(result.failed).toBe(1);
      expect(result.success).toBe(true);
    });
  });
});

// ── reconcilePendingTransactions (backward-compat wrapper) ──

describe('reconcilePendingTransactions', () => {
  it('returns noPendingTag when no Pending tag exists', async () => {
    fetchMonarchPendingTransactions.mockResolvedValue({
      noPendingTag: true,
      noPendingTransactions: false,
      pendingTag: null,
      monarchPendingTransactions: [],
    });

    const result = await reconcilePendingTransactions('monarch-acct-1', [], 90, 'CREDIT_CARD');

    expect(result.noPendingTag).toBe(true);
  });

  it('returns noPendingTransactions when no pending txs found', async () => {
    fetchMonarchPendingTransactions.mockResolvedValue({
      noPendingTag: false,
      noPendingTransactions: true,
      pendingTag: { id: 'tag-pending', name: 'Pending' },
      monarchPendingTransactions: [],
    });

    const result = await reconcilePendingTransactions('monarch-acct-1', [], 90, 'CREDIT_CARD');

    expect(result.noPendingTransactions).toBe(true);
  });

  it('delegates to reconcileWealthsimpleFetchedPending for Phase 2', async () => {
    const monarchTx = makeMonarchTx('mtx-1', 'ws-tx:credit-transaction-abc123');

    fetchMonarchPendingTransactions.mockResolvedValue({
      noPendingTag: false,
      noPendingTransactions: false,
      pendingTag: { id: 'tag-pending', name: 'Pending' },
      monarchPendingTransactions: [monarchTx],
    });

    mockMonarchApi.updateTransaction.mockResolvedValue({});
    mockMonarchApi.setTransactionTags.mockResolvedValue({});

    const wsTx = makeWsTx('credit-transaction-abc123', { status: 'settled', amount: 25, amountSign: 'negative' });

    const result = await reconcilePendingTransactions(
      'monarch-acct-1',
      [wsTx],
      90,
      'CREDIT_CARD',
    );

    expect(result.settled).toBe(1);
    expect(fetchMonarchPendingTransactions).toHaveBeenCalledWith('monarch-acct-1', 90);
  });
});

// ── formatTransactionIdForNotes ─────────────────────────────

describe('formatTransactionIdForNotes', () => {
  it('formats a transaction ID with prefix', () => {
    expect(formatTransactionIdForNotes('credit-transaction-abc123')).toBe('ws-tx:credit-transaction-abc123');
  });

  it('returns empty string for null/undefined', () => {
    expect(formatTransactionIdForNotes(null)).toBe('');
    expect(formatTransactionIdForNotes(undefined)).toBe('');
  });
});

// ── formatReconciliationMessage ─────────────────────────────

describe('formatReconciliationMessage', () => {
  it('returns "No pending transactions" for noPendingTag', () => {
    expect(formatReconciliationMessage({ noPendingTag: true })).toBe('No pending transactions');
  });

  it('returns "No pending transactions" for noPendingTransactions', () => {
    expect(formatReconciliationMessage({ noPendingTransactions: true })).toBe('No pending transactions');
  });

  it('returns "Nothing settled or cancelled" for all zeros', () => {
    expect(formatReconciliationMessage({ settled: 0, cancelled: 0, failed: 0 })).toBe('Nothing settled or cancelled');
  });

  it('formats settled and cancelled counts', () => {
    expect(formatReconciliationMessage({ settled: 2, cancelled: 1, failed: 0 })).toBe('2 settled, 1 cancelled');
  });

  it('includes failed count', () => {
    expect(formatReconciliationMessage({ settled: 1, cancelled: 0, failed: 2 })).toBe('1 settled, 2 failed');
  });
});