/**
 * Shared jest mock helper for `escapeHtml` from `src/core/utils`.
 *
 * UI suites mock `src/core/utils` wholesale (it pulls in config, storage and
 * toast), which means every escaping sink in the component under test would see
 * `escapeHtml === undefined`. That would both crash the suite and, worse, hide
 * XSS regressions behind a mock.
 *
 * The REAL implementation is used via `requireActual` so the escaping behaviour
 * asserted in UI tests cannot drift from production.
 *
 * Usage — the `require` must be INSIDE the factory, because jest hoists
 * `jest.mock` above module-scope declarations:
 *
 *   jest.mock('../../src/core/utils', () => {
 *     const { realEscapeHtml } = require('../helpers/escapeHtmlMock');
 *     return {
 *       debugLog: jest.fn(),
 *       escapeHtml: realEscapeHtml(),
 *     };
 *   });
 */

/**
 * Returns the real `escapeHtml` implementation.
 */
function realEscapeHtml() {
  // eslint-disable-next-line global-require
  return jest.requireActual('../../src/core/utils').escapeHtml;
}

module.exports = { realEscapeHtml };
