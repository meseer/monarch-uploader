/**
 * Per-Account Sync Lock
 *
 * A sync reads the account's dedup store (`uploadedTransactions`) when it starts
 * and records the newly uploaded IDs when its upload finishes. Two syncs of the
 * same account that overlap — from two tabs, or from two click handlers that
 * both resume once a Monarch login completes — both see the same store, both
 * upload the same new transactions, and Monarch ends up with duplicates.
 *
 * The lock lives in userscript storage, which every tab running this script
 * shares. GM_getValue/GM_setValue are synchronous, so acquiring is atomic within
 * a tab. Across tabs a near-simultaneous start can still race; the lock closes
 * the realistic windows (a second tab, a repeated click), not every theoretical
 * one. Separately installed copies of the script have separate storage — and
 * separate dedup stores — so no lock can coordinate them.
 *
 * @module services/common/syncLock
 */

import { debugLog } from '../../core/utils';

/**
 * How long a lock is honoured if it is never released.
 *
 * Longer than the longest legitimate sync of one account (waiting for Monarch to
 * process an import alone can take 10 minutes), short enough that a crashed tab
 * does not block the account for long. A tab that closes or reloads normally
 * releases its lock on `pagehide`.
 */
export const SYNC_LOCK_TTL_MS = 20 * 60 * 1000;

interface SyncLockRecord {
  token: string;
  acquiredAt: number;
}

/** Handle for a held lock */
export interface SyncLock {
  /** Release the lock. Safe to call more than once. */
  release(): void;
}

/**
 * Storage key for an account's lock, following `{integration}_{purpose}_{suffix}`.
 */
function getLockKey(integrationId: string, accountId: string): string {
  return `${integrationId}_sync_lock_${accountId}`;
}

/**
 * Read a lock record, treating anything unreadable as no lock.
 */
function readLock(key: string): SyncLockRecord | null {
  const raw = GM_getValue(key, null) as string | null;
  if (!raw) return null;

  try {
    const record = JSON.parse(raw) as Partial<SyncLockRecord>;
    if (typeof record?.token === 'string' && typeof record.acquiredAt === 'number') {
      return record as SyncLockRecord;
    }
  } catch {
    // Corrupt value: fall through and let the caller overwrite it.
  }
  debugLog(`[syncLock] Ignoring unreadable lock value for ${key}`);
  return null;
}

/**
 * Describe how long ago a lock was taken, for the "already running" message.
 */
function describeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 1) return 'less than a minute ago';
  return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`;
}

/**
 * Acquire the sync lock for one account.
 *
 * Call it first thing inside the sync's `try`, and release it in `finally`.
 * An expired lock (older than SYNC_LOCK_TTL_MS) is taken over.
 *
 * @param integrationId - Integration identifier (e.g. 'rogersbank')
 * @param accountId - Source account ID
 * @returns The held lock
 * @throws When another sync of the same account holds the lock
 */
export function acquireSyncLock(integrationId: string, accountId: string): SyncLock {
  const key = getLockKey(integrationId, accountId);
  const now = Date.now();
  const existing = readLock(key);

  if (existing) {
    const ageMs = now - existing.acquiredAt;
    if (ageMs < SYNC_LOCK_TTL_MS) {
      throw new Error(
        `Another sync of this account is already running (started ${describeAge(ageMs)}), possibly in another tab. `
        + 'Wait for it to finish before syncing again.',
      );
    }
    debugLog(`[syncLock] Taking over expired lock ${key} (age ${Math.round(ageMs / 1000)}s)`);
  }

  const token = `${now}-${Math.random().toString(36).slice(2)}`;
  GM_setValue(key, JSON.stringify({ token, acquiredAt: now } satisfies SyncLockRecord));
  debugLog(`[syncLock] Acquired ${key}`);

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    window.removeEventListener('pagehide', release);

    // Only remove our own lock: an expired one may have been taken over.
    if (readLock(key)?.token === token) {
      GM_deleteValue(key);
      debugLog(`[syncLock] Released ${key}`);
    }
  };
  window.addEventListener('pagehide', release);

  return { release };
}
