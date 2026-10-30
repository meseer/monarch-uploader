/**
 * Shared vitest mock helper for `escapeHtml` from `src/core/utils`.
 *
 * UI suites mock `src/core/utils` wholesale (it pulls in config, storage and
 * toast), which means every escaping sink in the component under test would see
 * `escapeHtml === undefined`. That would both crash the suite and, worse, hide
 * XSS regressions behind a mock.
 *
 * The REAL implementation is loaded via `vi.importActual` so the escaping
 * behaviour asserted in UI tests cannot drift from production.
 *
 * Usage — the `import` must be INSIDE the factory, because vitest hoists
 * `vi.mock` above module-scope declarations and imports:
 *
 *   vi.mock('../../src/core/utils', async () => {
 *     const { realEscapeHtml } = await import('../helpers/escapeHtmlMock');
 *     return {
 *       debugLog: vi.fn(),
 *       escapeHtml: realEscapeHtml(),
 *     };
 *   });
 */

// Resolved once at module load (top-level await) so `realEscapeHtml()` stays
// synchronous for factory call sites.
const actualUtils = await vi.importActual('../../src/core/utils');

/**
 * Returns the real `escapeHtml` implementation.
 */
export function realEscapeHtml() {
  return actualUtils.escapeHtml;
}
