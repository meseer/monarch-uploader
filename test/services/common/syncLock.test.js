/**
 * Tests for the per-account sync lock
 * @module test/services/common/syncLock
 */

import { acquireSyncLock, SYNC_LOCK_TTL_MS } from '../../../src/services/common/syncLock';

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
}));

const KEY = 'rogersbank_sync_lock_acc-1';

describe('syncLock', () => {
  let store;

  beforeEach(() => {
    store = new Map();
    globalThis.GM_getValue = vi.fn((key, defaultValue) => (store.has(key) ? store.get(key) : defaultValue));
    globalThis.GM_setValue = vi.fn((key, value) => store.set(key, value));
    globalThis.GM_deleteValue = vi.fn((key) => store.delete(key));
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000_000);
  });

  afterEach(() => {
    // Release every lock a test left held, so no pagehide listener leaks into
    // the next test through the shared window.
    window.dispatchEvent(new Event('pagehide'));
    vi.restoreAllMocks();
  });

  it('stores the lock under {integration}_sync_lock_{accountId} and removes it on release', () => {
    const lock = acquireSyncLock('rogersbank', 'acc-1');

    expect(JSON.parse(store.get(KEY))).toEqual({ token: expect.any(String), acquiredAt: 1_000_000_000 });

    lock.release();
    expect(store.has(KEY)).toBe(false);
  });

  it('refuses a second sync of the same account while the first holds the lock', () => {
    acquireSyncLock('rogersbank', 'acc-1');

    expect(() => acquireSyncLock('rogersbank', 'acc-1'))
      .toThrow('Another sync of this account is already running (started less than a minute ago), possibly in another tab.');
  });

  it('says how long ago the running sync started', () => {
    acquireSyncLock('rogersbank', 'acc-1');
    Date.now.mockReturnValue(1_000_000_000 + 3 * 60_000 + 10_000);

    expect(() => acquireSyncLock('rogersbank', 'acc-1')).toThrow('started 3 minutes ago');
  });

  it('allows the account to sync again once the lock is released', () => {
    acquireSyncLock('rogersbank', 'acc-1').release();

    expect(() => acquireSyncLock('rogersbank', 'acc-1')).not.toThrow();
  });

  it('locks accounts and integrations independently', () => {
    acquireSyncLock('rogersbank', 'acc-1');

    expect(() => acquireSyncLock('rogersbank', 'acc-2')).not.toThrow();
    expect(() => acquireSyncLock('mbna', 'acc-1')).not.toThrow();
  });

  it('takes over a lock older than the TTL, left behind by a crashed tab', () => {
    acquireSyncLock('rogersbank', 'acc-1');
    Date.now.mockReturnValue(1_000_000_000 + SYNC_LOCK_TTL_MS);

    expect(() => acquireSyncLock('rogersbank', 'acc-1')).not.toThrow();
  });

  it('does not delete a lock that another sync took over after it expired', () => {
    const stale = acquireSyncLock('rogersbank', 'acc-1');
    Date.now.mockReturnValue(1_000_000_000 + SYNC_LOCK_TTL_MS);
    acquireSyncLock('rogersbank', 'acc-1');
    const takenOver = store.get(KEY);

    stale.release();

    expect(store.get(KEY)).toBe(takenOver);
  });

  it('ignores a release called more than once', () => {
    const first = acquireSyncLock('rogersbank', 'acc-1');
    first.release();
    acquireSyncLock('rogersbank', 'acc-1');

    first.release();

    expect(store.has(KEY)).toBe(true);
  });

  it('releases the lock when the tab closes or reloads', () => {
    acquireSyncLock('rogersbank', 'acc-1');

    window.dispatchEvent(new Event('pagehide'));

    expect(store.has(KEY)).toBe(false);
  });

  it('stops listening for pagehide once released', () => {
    acquireSyncLock('rogersbank', 'acc-1').release();
    acquireSyncLock('rogersbank', 'acc-2');
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    window.dispatchEvent(new Event('pagehide'));

    // Only the still-held acc-2 lock reacts; acc-1 detached on release.
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['not JSON', 'not-json'],
    ['missing fields', JSON.stringify({ owner: 'x' })],
  ])('treats an unreadable lock value (%s) as no lock', (_label, value) => {
    store.set(KEY, value);

    expect(() => acquireSyncLock('rogersbank', 'acc-1')).not.toThrow();
  });
});
