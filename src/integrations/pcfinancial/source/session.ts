import type { StorageAdapter } from '../../../core/storageAdapter';

export const SESSION_KEY = 'pcfinancial_api_session';

export interface PcFinancialSession {
  accountIds: string[];
  headers: Record<string, string>;
}

/** Return the captured PC Financial session, if a request has been observed. */
export function getSession(storage: StorageAdapter): PcFinancialSession | null {
  return storage.get(SESSION_KEY) as PcFinancialSession | null;
}

/** Save credentials only after a successful account API request. */
export function saveSession(
  storage: StorageAdapter,
  accountId: string,
  headers: Record<string, string>,
): void {
  const previous = getSession(storage);
  storage.set(SESSION_KEY, {
    accountIds: [...new Set([
      ...(previous?.headers.authorization === headers.authorization ? previous.accountIds : []),
      accountId,
    ])],
    headers,
  } satisfies PcFinancialSession);
}
