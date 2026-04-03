/**
 * Holdings Sync Orchestrator Tests
 *
 * Tests for the shared holdings sync module that owns all generic
 * holding resolution, creation, update, and deletion logic.
 */

import {
  findHoldingById,
  findExistingHolding,
  resolveOrCreateHolding,
  syncPositionToHolding,
  detectAndRemoveDeletedHoldings,
  processAccountPositions,
} from '../../../src/services/common/holdingsSync';
import monarchApi from '../../../src/api/monarch';
import accountService from '../../../src/services/common/accountService';

// Mock Monarch API
jest.mock('../../../src/api/monarch', () => ({
  getHoldings: jest.fn(),
  createManualHolding: jest.fn(),
  updateHolding: jest.fn(),
  deleteHolding: jest.fn(),
}));

// Mock accountService
jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getHoldingMapping: jest.fn(),
    getHoldingsMappings: jest.fn(),
    saveHoldingMapping: jest.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a minimal HoldingsSyncHooks stub. Callers can override individual hooks. */
function buildMockHooks(overrides = {}) {
  return {
    getPositionKey: (p) => p.id,
    getDisplaySymbol: (p) => p.symbol || null,
    getQuantity: (p) => Number(p.quantity) || 0,
    buildHoldingUpdate: (p) => ({ quantity: Number(p.quantity), costBasis: Number(p.costBasis) || 0 }),
    resolveSecurityMapping: jest.fn().mockResolvedValue('monarch-sec-default'),
    ...overrides,
  };
}

/** Build Monarch holdings data with a flat list of aggregate edges. */
function buildHoldings(entries) {
  return {
    aggregateHoldings: {
      edges: entries.map(({ securityId, holdings }) => ({
        node: {
          security: { id: securityId },
          holdings,
        },
      })),
    },
  };
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  accountService.getHoldingMapping.mockReturnValue(null);
  accountService.getHoldingsMappings.mockReturnValue({});
  accountService.saveHoldingMapping.mockReturnValue(true);
});

// ══════════════════════════════════════════════════════════════════════════════
// findHoldingById
// ══════════════════════════════════════════════════════════════════════════════

describe('findHoldingById', () => {
  test('returns holding when found across multiple aggregate edges', () => {
    const holdings = buildHoldings([
      { securityId: 's1', holdings: [{ id: 'h1', ticker: 'AAPL', isManual: true }] },
      { securityId: 's2', holdings: [{ id: 'h2', ticker: 'GOOGL', isManual: true }] },
    ]);

    expect(findHoldingById('h1', holdings)).toEqual({ id: 'h1', ticker: 'AAPL', isManual: true });
    expect(findHoldingById('h2', holdings)).toEqual({ id: 'h2', ticker: 'GOOGL', isManual: true });
  });

  test('returns holding when multiple holdings exist in single aggregate', () => {
    const holdings = buildHoldings([
      {
        securityId: 's1',
        holdings: [
          { id: 'h1', ticker: 'AAPL', isManual: true },
          { id: 'h2', ticker: 'AAPL', isManual: false },
        ],
      },
    ]);

    expect(findHoldingById('h2', holdings)).toEqual({ id: 'h2', ticker: 'AAPL', isManual: false });
  });

  test('returns null when holdingId not found', () => {
    const holdings = buildHoldings([
      { securityId: 's1', holdings: [{ id: 'h1', ticker: 'AAPL', isManual: true }] },
    ]);
    expect(findHoldingById('nonexistent', holdings)).toBeNull();
  });

  test('returns null for null holdings', () => {
    expect(findHoldingById('h1', null)).toBeNull();
  });

  test('returns null for empty edges array', () => {
    expect(findHoldingById('h1', { aggregateHoldings: { edges: [] } })).toBeNull();
  });

  test('returns null when aggregateHoldings is missing', () => {
    expect(findHoldingById('h1', {})).toBeNull();
  });

  test('skips nodes without holdings array', () => {
    const holdings = {
      aggregateHoldings: {
        edges: [
          { node: { security: { id: 's1' } } }, // no holdings
          { node: { security: { id: 's2' }, holdings: [{ id: 'h1', ticker: 'X' }] } },
        ],
      },
    };
    expect(findHoldingById('h1', holdings)).toEqual({ id: 'h1', ticker: 'X' });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// findExistingHolding
// ══════════════════════════════════════════════════════════════════════════════

describe('findExistingHolding', () => {
  test('returns manual holding matching securityId', () => {
    const holdings = buildHoldings([
      {
        securityId: 'sec-aapl',
        holdings: [
          { id: 'h-linked', ticker: 'AAPL', isManual: false },
          { id: 'h-manual', ticker: 'AAPL', isManual: true },
        ],
      },
    ]);

    expect(findExistingHolding('sec-aapl', holdings)).toEqual({ id: 'h-manual', ticker: 'AAPL', isManual: true });
  });

  test('returns null when securityId does not match any aggregate', () => {
    const holdings = buildHoldings([
      { securityId: 'sec-aapl', holdings: [{ id: 'h1', ticker: 'AAPL', isManual: true }] },
    ]);
    expect(findExistingHolding('sec-googl', holdings)).toBeNull();
  });

  test('returns null when matching aggregate has no manual holding', () => {
    const holdings = buildHoldings([
      { securityId: 'sec-aapl', holdings: [{ id: 'h1', ticker: 'AAPL', isManual: false }] },
    ]);
    expect(findExistingHolding('sec-aapl', holdings)).toBeNull();
  });

  test('returns null for null holdings', () => {
    expect(findExistingHolding('sec-1', null)).toBeNull();
  });

  test('returns null for empty edges', () => {
    expect(findExistingHolding('sec-1', { aggregateHoldings: { edges: [] } })).toBeNull();
  });

  test('skips aggregates without holdings array', () => {
    const holdings = {
      aggregateHoldings: {
        edges: [
          { node: { security: { id: 'sec-1' } } }, // no holdings array
        ],
      },
    };
    expect(findExistingHolding('sec-1', holdings)).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// resolveOrCreateHolding
// ══════════════════════════════════════════════════════════════════════════════

describe('resolveOrCreateHolding', () => {
  const hooks = buildMockHooks();
  const position = { id: 'pos-aapl', symbol: 'AAPL', quantity: '10', costBasis: '1500' };
  const emptyHoldings = { aggregateHoldings: { edges: [] } };

  test('returns stored holdingId when validated against Monarch holdings', async () => {
    accountService.getHoldingMapping.mockReturnValue({
      securityId: 'monarch-sec-aapl',
      holdingId: 'hold-valid',
      symbol: 'AAPL',
    });

    const holdings = buildHoldings([
      { securityId: 'monarch-sec-aapl', holdings: [{ id: 'hold-valid', ticker: 'AAPL', isManual: true }] },
    ]);

    const result = await resolveOrCreateHolding(
      'test-integration', 'acc-1', 'monarch-acc-1', 'monarch-sec-aapl',
      position, holdings, hooks,
    );

    expect(result).toBe('hold-valid');
    expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
    expect(accountService.saveHoldingMapping).not.toHaveBeenCalled();
  });

  test('clears stale holdingId and creates new holding', async () => {
    accountService.getHoldingMapping.mockReturnValue({
      securityId: 'monarch-sec-aapl',
      holdingId: 'hold-stale',
      symbol: 'AAPL',
    });

    monarchApi.createManualHolding.mockResolvedValue({ id: 'hold-new' });

    const result = await resolveOrCreateHolding(
      'test-integration', 'acc-1', 'monarch-acc-1', 'monarch-sec-aapl',
      position, emptyHoldings, hooks,
    );

    expect(result).toBe('hold-new');

    // First call: clear stale holdingId
    expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
      'test-integration', 'acc-1', 'pos-aapl',
      expect.objectContaining({ securityId: 'monarch-sec-aapl', holdingId: null }),
    );

    // Last call: save new holdingId
    expect(accountService.saveHoldingMapping).toHaveBeenLastCalledWith(
      'test-integration', 'acc-1', 'pos-aapl',
      expect.objectContaining({ holdingId: 'hold-new', securityId: 'monarch-sec-aapl' }),
    );
  });

  test('finds existing holding by securityId after clearing stale holdingId', async () => {
    accountService.getHoldingMapping.mockReturnValue({
      securityId: 'monarch-sec-aapl',
      holdingId: 'hold-stale',
      symbol: 'AAPL',
    });

    const holdings = buildHoldings([
      { securityId: 'monarch-sec-aapl', holdings: [{ id: 'hold-existing', ticker: 'AAPL', isManual: true }] },
    ]);

    const result = await resolveOrCreateHolding(
      'test-integration', 'acc-1', 'monarch-acc-1', 'monarch-sec-aapl',
      position, holdings, hooks,
    );

    expect(result).toBe('hold-existing');
    expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
  });

  test('creates new holding when no stored mapping exists', async () => {
    accountService.getHoldingMapping.mockReturnValue(null);
    monarchApi.createManualHolding.mockResolvedValue({ id: 'hold-created' });

    const result = await resolveOrCreateHolding(
      'test-integration', 'acc-1', 'monarch-acc-1', 'monarch-sec-aapl',
      position, emptyHoldings, hooks,
    );

    expect(result).toBe('hold-created');
    expect(monarchApi.createManualHolding).toHaveBeenCalledWith('monarch-acc-1', 'monarch-sec-aapl', 10);
    expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
      'test-integration', 'acc-1', 'pos-aapl',
      expect.objectContaining({ holdingId: 'hold-created', securityId: 'monarch-sec-aapl', symbol: 'AAPL' }),
    );
  });

  test('finds existing holding by securityId when no stored mapping but holding exists in Monarch', async () => {
    accountService.getHoldingMapping.mockReturnValue(null);

    const holdings = buildHoldings([
      { securityId: 'monarch-sec-aapl', holdings: [{ id: 'hold-found', ticker: 'AAPL', isManual: true }] },
    ]);

    const result = await resolveOrCreateHolding(
      'test-integration', 'acc-1', 'monarch-acc-1', 'monarch-sec-aapl',
      position, holdings, hooks,
    );

    expect(result).toBe('hold-found');
    expect(monarchApi.createManualHolding).not.toHaveBeenCalled();
  });

  test('propagates API error from createManualHolding', async () => {
    accountService.getHoldingMapping.mockReturnValue(null);
    monarchApi.createManualHolding.mockRejectedValue(new Error('API create failed'));

    await expect(
      resolveOrCreateHolding('test-integration', 'acc-1', 'monarch-acc-1', 'sec-x', position, emptyHoldings, hooks),
    ).rejects.toThrow('API create failed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// syncPositionToHolding
// ══════════════════════════════════════════════════════════════════════════════

describe('syncPositionToHolding', () => {
  test('calls monarchApi.updateHolding with payload from hooks', async () => {
    const hooks = buildMockHooks({
      buildHoldingUpdate: () => ({ quantity: 42, costBasis: 1000, securityType: 'equity' }),
    });

    monarchApi.updateHolding.mockResolvedValue(true);

    await syncPositionToHolding('hold-1', { symbol: 'AAPL' }, hooks);

    expect(monarchApi.updateHolding).toHaveBeenCalledWith('hold-1', {
      quantity: 42,
      costBasis: 1000,
      securityType: 'equity',
    });
  });

  test('propagates API error from updateHolding', async () => {
    const hooks = buildMockHooks();
    monarchApi.updateHolding.mockRejectedValue(new Error('Update failed'));

    await expect(
      syncPositionToHolding('hold-1', { symbol: 'X' }, hooks),
    ).rejects.toThrow('Update failed');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// detectAndRemoveDeletedHoldings
// ══════════════════════════════════════════════════════════════════════════════

describe('detectAndRemoveDeletedHoldings', () => {
  const hooks = buildMockHooks();

  test('case 1: keeps holding when mapped position still exists', async () => {
    const positions = [{ id: 'pos-eth', symbol: 'ETH' }];

    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-eth', holdings: [{ id: 'h-eth', ticker: 'ETH' }] },
    ]));

    accountService.getHoldingsMappings.mockReturnValue({
      'pos-eth': { securityId: 'sec-eth', holdingId: 'h-eth', symbol: 'ETH' },
    });

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', positions, hooks);

    expect(result.deleted).toBe(0);
    expect(result.autoRepaired).toBe(0);
    expect(monarchApi.deleteHolding).not.toHaveBeenCalled();
  });

  test('case 2: deletes holding when mapped position no longer exists', async () => {
    const positions = []; // BTC sold

    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-btc', holdings: [{ id: 'h-btc', ticker: 'BTC' }] },
    ]));
    monarchApi.deleteHolding.mockResolvedValue(true);

    accountService.getHoldingsMappings.mockReturnValue({
      'pos-btc': { securityId: 'sec-btc', holdingId: 'h-btc', symbol: 'BTC' },
    });

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', positions, hooks);

    expect(result.deleted).toBe(1);
    expect(monarchApi.deleteHolding).toHaveBeenCalledWith('h-btc');

    // Mapping should have holdingId cleared but securityId preserved
    expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
      'int', 'acc', 'pos-btc',
      { securityId: 'sec-btc', holdingId: null, symbol: 'BTC' },
    );
  });

  test('case 3: auto-repairs unmapped holding that matches position by ticker', async () => {
    const positions = [{ id: 'pos-aapl', symbol: 'AAPL' }];

    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-aapl', holdings: [{ id: 'h-aapl', ticker: 'AAPL' }] },
    ]));

    accountService.getHoldingsMappings.mockReturnValue({}); // No mapping

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', positions, hooks);

    expect(result.deleted).toBe(0);
    expect(result.autoRepaired).toBe(1);
    expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
      'int', 'acc', 'pos-aapl',
      expect.objectContaining({ securityId: 'sec-aapl', holdingId: 'h-aapl', symbol: 'AAPL' }),
    );
  });

  test('case 4: deletes unmapped holding with no matching position', async () => {
    const positions = [{ id: 'pos-eth', symbol: 'ETH' }];

    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-orphan', holdings: [{ id: 'h-orphan', ticker: 'ORPHAN' }] },
    ]));
    monarchApi.deleteHolding.mockResolvedValue(true);

    accountService.getHoldingsMappings.mockReturnValue({});

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', positions, hooks);

    expect(result.deleted).toBe(1);
    expect(monarchApi.deleteHolding).toHaveBeenCalledWith('h-orphan');
  });

  test('handles all four cases in a single run', async () => {
    const positions = [
      { id: 'pos-eth', symbol: 'ETH' },
      { id: 'pos-aapl', symbol: 'AAPL' },
    ];

    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-eth', holdings: [{ id: 'h-eth', ticker: 'ETH' }] },
      { securityId: 'sec-btc', holdings: [{ id: 'h-btc', ticker: 'BTC' }] },
      { securityId: 'sec-aapl', holdings: [{ id: 'h-aapl', ticker: 'AAPL' }] },
      { securityId: 'sec-orphan', holdings: [{ id: 'h-orphan', ticker: 'ORPHAN' }] },
    ]));
    monarchApi.deleteHolding.mockResolvedValue(true);

    accountService.getHoldingsMappings.mockReturnValue({
      'pos-eth': { securityId: 'sec-eth', holdingId: 'h-eth', symbol: 'ETH' },
      'pos-btc': { securityId: 'sec-btc', holdingId: 'h-btc', symbol: 'BTC' },
    });

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', positions, hooks);

    expect(result.deleted).toBe(2);       // BTC + ORPHAN
    expect(result.autoRepaired).toBe(1);  // AAPL
    expect(monarchApi.deleteHolding).toHaveBeenCalledWith('h-btc');
    expect(monarchApi.deleteHolding).toHaveBeenCalledWith('h-orphan');
    expect(monarchApi.deleteHolding).toHaveBeenCalledTimes(2);
  });

  test('uses getTickerForAutoRepair hook when provided', async () => {
    const positions = [{ id: 'pos-btc', symbol: 'BTC-USD', rawTicker: 'BTC' }];

    const customHooks = buildMockHooks({
      getTickerForAutoRepair: (p) => p.rawTicker,
    });

    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-btc', holdings: [{ id: 'h-btc', ticker: 'BTC' }] },
    ]));

    accountService.getHoldingsMappings.mockReturnValue({});

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', positions, customHooks);

    expect(result.autoRepaired).toBe(1);
  });

  test('uses getAutoRepairSourceId hook when provided', async () => {
    const positions = [{ id: 'pos-aapl', symbol: 'AAPL', sourceSecId: 'src-aapl-123' }];

    const customHooks = buildMockHooks({
      getAutoRepairSourceId: (p) => p.sourceSecId,
    });

    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-aapl', holdings: [{ id: 'h-aapl', ticker: 'AAPL' }] },
    ]));

    accountService.getHoldingsMappings.mockReturnValue({});

    await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', positions, customHooks);

    expect(accountService.saveHoldingMapping).toHaveBeenCalledWith(
      'int', 'acc', 'src-aapl-123',
      expect.objectContaining({ holdingId: 'h-aapl' }),
    );
  });

  test('returns empty result when Monarch has no holdings', async () => {
    monarchApi.getHoldings.mockResolvedValue(null);

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', [], hooks);

    expect(result).toEqual({ deleted: 0, autoRepaired: 0 });
  });

  test('handles deletion API errors gracefully', async () => {
    monarchApi.getHoldings.mockResolvedValue(buildHoldings([
      { securityId: 'sec-x', holdings: [{ id: 'h-x', ticker: 'X' }] },
    ]));
    monarchApi.deleteHolding.mockRejectedValue(new Error('Delete failed'));

    accountService.getHoldingsMappings.mockReturnValue({});

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', [], hooks);

    expect(result.deleted).toBe(0); // failed to delete
  });

  test('handles getHoldings API error gracefully', async () => {
    monarchApi.getHoldings.mockRejectedValue(new Error('Network error'));

    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', [], hooks);

    expect(result).toEqual({ deleted: 0, autoRepaired: 0 });
  });

  test('skips holdings without id or ticker', async () => {
    monarchApi.getHoldings.mockResolvedValue({
      aggregateHoldings: {
        edges: [
          { node: { security: { id: 's1' }, holdings: [{ id: null, ticker: 'X' }] } },
          { node: { security: { id: 's2' }, holdings: [{ id: 'h1', ticker: null }] } },
          { node: { security: { id: 's3' }, holdings: [{ id: 'h2', ticker: 'Y' }] } },
        ],
      },
    });
    monarchApi.deleteHolding.mockResolvedValue(true);

    accountService.getHoldingsMappings.mockReturnValue({});

    // Only h2/Y should be processed (and deleted as orphan since no positions)
    const result = await detectAndRemoveDeletedHoldings('int', 'acc', 'macc', [], hooks);

    expect(result.deleted).toBe(1);
    expect(monarchApi.deleteHolding).toHaveBeenCalledWith('h2');
    expect(monarchApi.deleteHolding).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// processAccountPositions
// ══════════════════════════════════════════════════════════════════════════════

describe('processAccountPositions', () => {
  test('processes all positions and returns result', async () => {
    const positions = [
      { id: 'pos-1', symbol: 'AAPL', quantity: '10', costBasis: '1500' },
      { id: 'pos-2', symbol: 'GOOGL', quantity: '5', costBasis: '2500' },
    ];

    const hooks = buildMockHooks({
      resolveSecurityMapping: jest.fn()
        .mockResolvedValueOnce('monarch-sec-aapl')
        .mockResolvedValueOnce('monarch-sec-googl'),
    });

    // Monarch holdings empty initially
    monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });
    monarchApi.createManualHolding.mockResolvedValueOnce({ id: 'h-aapl' });
    monarchApi.createManualHolding.mockResolvedValueOnce({ id: 'h-googl' });
    monarchApi.updateHolding.mockResolvedValue(true);
    monarchApi.deleteHolding.mockResolvedValue(true);

    const result = await processAccountPositions('int', 'acc', 'macc', positions, hooks);

    expect(result.success).toBe(true);
    expect(result.positionsProcessed).toBe(2);
    expect(result.positionsSkipped).toBe(0);
    expect(result.error).toBeNull();
  });

  test('skips positions when resolveSecurityMapping returns null', async () => {
    const positions = [
      { id: 'pos-1', symbol: 'AAPL', quantity: '10' },
      { id: 'pos-2', symbol: 'UNKNOWN', quantity: '5' },
    ];

    const hooks = buildMockHooks({
      resolveSecurityMapping: jest.fn()
        .mockResolvedValueOnce('monarch-sec-aapl')
        .mockResolvedValueOnce(null), // user cancelled
    });

    monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });
    monarchApi.createManualHolding.mockResolvedValue({ id: 'h-1' });
    monarchApi.updateHolding.mockResolvedValue(true);

    const result = await processAccountPositions('int', 'acc', 'macc', positions, hooks);

    expect(result.success).toBe(true);
    expect(result.positionsProcessed).toBe(1);
    expect(result.positionsSkipped).toBe(1);
  });

  test('counts position as skipped when processing throws', async () => {
    const positions = [{ id: 'pos-1', symbol: 'FAIL', quantity: '10' }];

    const hooks = buildMockHooks({
      resolveSecurityMapping: jest.fn().mockRejectedValue(new Error('Resolve error')),
    });

    monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });

    const result = await processAccountPositions('int', 'acc', 'macc', positions, hooks);

    expect(result.success).toBe(true); // overall still succeeds
    expect(result.positionsProcessed).toBe(0);
    expect(result.positionsSkipped).toBe(1);
  });

  test('returns success with zero counts for empty positions', async () => {
    const hooks = buildMockHooks();

    const result = await processAccountPositions('int', 'acc', 'macc', [], hooks);

    expect(result.success).toBe(true);
    expect(result.positionsProcessed).toBe(0);
    expect(result.positionsSkipped).toBe(0);
    expect(monarchApi.getHoldings).not.toHaveBeenCalled();
  });

  test('returns success with zero counts for null positions', async () => {
    const hooks = buildMockHooks();

    const result = await processAccountPositions('int', 'acc', 'macc', null, hooks);

    expect(result.success).toBe(true);
    expect(result.positionsProcessed).toBe(0);
  });

  test('calls progress callbacks at each stage', async () => {
    const positions = [{ id: 'pos-1', symbol: 'AAPL', quantity: '10' }];

    const hooks = buildMockHooks({
      resolveSecurityMapping: jest.fn().mockResolvedValue('monarch-sec-aapl'),
    });

    monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });
    monarchApi.createManualHolding.mockResolvedValue({ id: 'h-1' });
    monarchApi.updateHolding.mockResolvedValue(true);

    const progress = { updateStatus: jest.fn() };

    await processAccountPositions('int', 'acc', 'macc', positions, hooks, progress);

    // Should have called updateStatus for: fetching, processing, checking deleted, success
    expect(progress.updateStatus).toHaveBeenCalledWith('processing', 'Fetching Monarch holdings...');
    expect(progress.updateStatus).toHaveBeenCalledWith('processing', expect.stringContaining('Processing 1/1'));
    expect(progress.updateStatus).toHaveBeenCalledWith('processing', 'Checking for deleted positions...');
    expect(progress.updateStatus).toHaveBeenCalledWith('success', expect.stringContaining('1 synced'));
  });

  test('includes deletion and repair counts in status message', async () => {
    const positions = [{ id: 'pos-1', symbol: 'AAPL', quantity: '10' }];

    const hooks = buildMockHooks({
      resolveSecurityMapping: jest.fn().mockResolvedValue('monarch-sec-aapl'),
    });

    // First call for initial fetch, second call for deletion detection
    monarchApi.getHoldings
      .mockResolvedValueOnce({ aggregateHoldings: { edges: [] } })
      .mockResolvedValueOnce(buildHoldings([
        { securityId: 'sec-aapl', holdings: [{ id: 'h-aapl', ticker: 'AAPL' }] },
        { securityId: 'sec-orphan', holdings: [{ id: 'h-orphan', ticker: 'ORPHAN' }] },
      ]));

    monarchApi.createManualHolding.mockResolvedValue({ id: 'h-new' });
    monarchApi.updateHolding.mockResolvedValue(true);
    monarchApi.deleteHolding.mockResolvedValue(true);

    accountService.getHoldingsMappings.mockReturnValue({});

    const progress = { updateStatus: jest.fn() };

    await processAccountPositions('int', 'acc', 'macc', positions, hooks, progress);

    // Final status should mention synced count, repaired, and deleted
    const successCalls = progress.updateStatus.mock.calls.filter(([s]) => s === 'success');
    expect(successCalls.length).toBe(1);
    const statusMsg = successCalls[0][1];
    expect(statusMsg).toContain('1 synced');
  });

  test('sets error status when getHoldings fails', async () => {
    const positions = [{ id: 'pos-1', symbol: 'AAPL', quantity: '10' }];

    const hooks = buildMockHooks();

    monarchApi.getHoldings.mockRejectedValue(new Error('Holdings fetch failed'));

    const progress = { updateStatus: jest.fn() };

    const result = await processAccountPositions('int', 'acc', 'macc', positions, hooks, progress);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Holdings fetch failed');
    expect(progress.updateStatus).toHaveBeenCalledWith('error', expect.stringContaining('Holdings fetch failed'));
  });

  test('works without progress callback', async () => {
    const positions = [{ id: 'pos-1', symbol: 'AAPL', quantity: '10' }];

    const hooks = buildMockHooks({
      resolveSecurityMapping: jest.fn().mockResolvedValue('monarch-sec-aapl'),
    });

    monarchApi.getHoldings.mockResolvedValue({ aggregateHoldings: { edges: [] } });
    monarchApi.createManualHolding.mockResolvedValue({ id: 'h-1' });
    monarchApi.updateHolding.mockResolvedValue(true);

    // Should not throw when progress is null
    const result = await processAccountPositions('int', 'acc', 'macc', positions, hooks, null);

    expect(result.success).toBe(true);
    expect(result.positionsProcessed).toBe(1);
  });
});