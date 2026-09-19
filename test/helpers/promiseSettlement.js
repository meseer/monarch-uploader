/**
 * Helper for asserting that a promise SETTLES, not merely that it settles a
 * particular way.
 *
 * `GM_xmlhttpRequest` handlers run asynchronously, outside the Promise
 * executor's synchronous flow, so a throw inside one escapes the Promise
 * entirely: neither `resolve` nor `reject` runs and the promise never settles.
 * No request timeout is configured anywhere in `src/api/`, so that hang is
 * permanent.
 *
 * `await expect(p).rejects.toThrow(...)` cannot express that bug. Against an
 * unsettled promise it fails as an opaque five-second Jest timeout attributed to
 * the whole test, which reads as "the suite is slow" rather than "the promise
 * hangs". So settlement is raced against a short deadline and asserted on as a
 * value instead: an unsettled promise then fails as a plain
 * `expected "rejected", received "pending"` assertion.
 *
 * Usage:
 *
 *   const outcome = await settlementOf(apiCall());
 *   expect(outcome.state).toBe('rejected');
 *   expect(outcome.error.message).toMatch(/not JSON/);
 */

/**
 * Observe how a promise settles, giving up after a deadline.
 *
 * Both handlers are attached immediately, so a rejection is always consumed and
 * never surfaces as an unhandled rejection warning.
 *
 * @param {Promise<unknown>} promise - Promise under test
 * @param {number} deadlineMs - How long to wait before reporting 'pending'
 * @returns {Promise<{state: 'resolved'|'rejected'|'pending', value?: unknown, error?: Error}>}
 *   The observed outcome. `state: 'pending'` means the promise never settled —
 *   the hang this helper exists to catch.
 */
function settlementOf(promise, deadlineMs = 250) {
  return Promise.race([
    promise.then(
      (value) => ({ state: 'resolved', value }),
      (error) => ({ state: 'rejected', error }),
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve({ state: 'pending' }), deadlineMs);
    }),
  ]);
}

module.exports = { settlementOf };
