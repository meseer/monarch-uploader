import { accountIdFromUrl, captureHeaders, createAuth } from '../../../src/integrations/pcfinancial/source/auth';
import { createMemoryStorageAdapter } from '../../../src/core/storageAdapter';
import { getSession, saveSession } from '../../../src/integrations/pcfinancial/source/session';

describe('PC Financial session capture', () => {
  it('accepts only account URLs on the API host', () => {
    expect(accountIdFromUrl('https://app.pcfinancial.ca/inet/banking/v2.0/accounts/abc/posted-transactions'))
      .toBe('abc');
    expect(accountIdFromUrl('https://other.example/inet/banking/v2.0/accounts/abc/posted-transactions'))
      .toBeNull();
  });

  it('stores only relevant headers and distinct account IDs', () => {
    const headers = captureHeaders({ Authorization: 'Bearer test', MCID: '123', Cookie: 'private' });
    expect(headers).toEqual({ authorization: 'Bearer test', mcid: '123' });
    const storage = createMemoryStorageAdapter();
    saveSession(storage, 'one', headers);
    saveSession(storage, 'one', headers);
    saveSession(storage, 'two', headers);
    expect(getSession(storage).accountIds).toEqual(['one', 'two']);
    saveSession(storage, 'three', { authorization: 'Bearer another' });
    expect(getSession(storage).accountIds).toEqual(['three']);
  });

  it('captures a successful page fetch without changing its response', async () => {
    const storage = createMemoryStorageAdapter();
    const response = { ok: true };
    class FakeXHR {
      open() {}
      setRequestHeader() {}
    }
    const previous = globalThis.unsafeWindow;
    globalThis.unsafeWindow = { fetch: jest.fn().mockResolvedValue(response), XMLHttpRequest: FakeXHR };
    try {
      const auth = createAuth(storage);
      auth.setupMonitoring();
      const result = await globalThis.unsafeWindow.fetch(
        'https://app.pcfinancial.ca/inet/banking/v2.0/accounts/abc/posted-transactions',
        { headers: { authorization: 'Bearer sample', mcid: '123' } },
      );
      expect(result).toBe(response);
      expect(getSession(storage).accountIds).toEqual(['abc']);
      expect(auth.checkStatus()).toEqual({ authenticated: true });
    } finally {
      globalThis.unsafeWindow = previous;
    }
  });
});
