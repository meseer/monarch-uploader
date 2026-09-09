/**
 * Shared jest mock factory for `src/utils/transactionStorage`.
 *
 * Several upload-service suites mock this module wholesale to isolate the service
 * under test. Hand-rolling the mock in each suite meant a newly exported function
 * silently became `undefined` there, which is exactly how `mergeNewestFirstRuns`
 * slipped through.
 *
 * Pure ordering helpers delegate to the REAL implementation via `requireActual`,
 * so they cannot drift from production behaviour and ordering bugs stay
 * detectable. Only the storage-shaped functions are stubbed, since those are what
 * the suites assert against.
 *
 * Usage — the `require` must be INSIDE the factory, because jest hoists
 * `jest.mock` above module-scope declarations:
 *
 *   jest.mock('../../src/utils/transactionStorage', () => {
 *     const { buildTransactionStorageMock } = require('../helpers/transactionStorageMock');
 *     return buildTransactionStorageMock();
 *   });
 *
 * @param {Object} [overrides] - Per-suite overrides merged over the defaults
 * @returns {Object} Mocked module shape
 */
function buildTransactionStorageMock(overrides = {}) {
  // Real implementations for the pure ordering helpers — these are the functions
  // whose behaviour the services depend on, so stubbing them would hide bugs.
  const actual = jest.requireActual('../../src/utils/transactionStorage');

  return {
    // ── Stubbed: storage-shaped, asserted against by the suites ──
    getTransactionIdsFromArray: jest.fn(() => new Set()),
    // Prepends, matching the newest-first storage invariant
    mergeAndRetainTransactions: jest.fn((existing, newRefs) => [...newRefs, ...(existing || [])]),
    getRetentionSettingsFromAccount: jest.fn(() => ({ retentionDays: 91, retentionCount: 1000 })),
    migrateLegacyTransactions: jest.fn((list) => list || []),

    // ── Real: pure ordering logic, must not drift ──
    mergeNewestFirstRuns: actual.mergeNewestFirstRuns,
    applyRetentionLimits: actual.applyRetentionLimits,

    ...overrides,
  };
}

module.exports = { buildTransactionStorageMock };