// Real implementations for the pure ordering helpers — these are the functions
// whose behaviour the services depend on, so stubbing them would hide bugs.
// Resolved once at module load (top-level await) so the builder stays synchronous.
const actual = await vi.importActual('../../src/utils/transactionStorage');

/**
 * Shared vitest mock factory for `src/utils/transactionStorage`.
 *
 * Several upload-service suites mock this module wholesale to isolate the service
 * under test. Hand-rolling the mock in each suite meant a newly exported function
 * silently became `undefined` there, which is exactly how `mergeNewestFirstRuns`
 * slipped through.
 *
 * Pure ordering helpers delegate to the REAL implementation via `vi.importActual`,
 * so they cannot drift from production behaviour and ordering bugs stay
 * detectable. Only the storage-shaped functions are stubbed, since those are what
 * the suites assert against.
 *
 * Usage — the `import` must be INSIDE the factory, because vitest hoists
 * `vi.mock` above module-scope declarations and imports:
 *
 *   vi.mock('../../src/utils/transactionStorage', async () => {
 *     const { buildTransactionStorageMock } = await import('../helpers/transactionStorageMock');
 *     return buildTransactionStorageMock();
 *   });
 *
 * @param {Object} [overrides] - Per-suite overrides merged over the defaults
 * @returns {Object} Mocked module shape
 */
export function buildTransactionStorageMock(overrides = {}) {
  return {
    // ── Stubbed: storage-shaped, asserted against by the suites ──
    getTransactionIdsFromArray: vi.fn(() => new Set()),
    // Prepends, matching the newest-first storage invariant
    mergeAndRetainTransactions: vi.fn((existing, newRefs) => [...newRefs, ...(existing || [])]),
    // Shape must match the real `RetentionSettings` ({ days, count }) — the mock
    // previously returned { retentionDays, retentionCount }, so every caller read
    // `undefined` and retention-window logic was silently untested.
    getRetentionSettingsFromAccount: vi.fn(() => ({ days: 91, count: 1000 })),
    migrateLegacyTransactions: vi.fn((list) => list || []),

    // ── Real: pure ordering logic, must not drift ──
    mergeNewestFirstRuns: actual.mergeNewestFirstRuns,
    applyRetentionLimits: actual.applyRetentionLimits,

    ...overrides,
  };
}
