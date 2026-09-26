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
    globalThis.unsafeWindow = {
      fetch: jest.fn().mockResolvedValue(response),
      XMLHttpRequest: FakeXHR,
    };
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

  it('recaptures XHR headers after the page replaces its request hooks', () => {
    const storage = createMemoryStorageAdapter();
    class FakeXHR {
      constructor() {
        this.status = 200;
        this.handlers = {};
        this.headers = {};
      }
      open(method, url) { this.url = url; }
      setRequestHeader(name, value) { this.headers[name] = value; }
      addEventListener(name, callback) { this.handlers[name] = callback; }
      send() { this.handlers.loadend?.(); }
    }
    const originalOpen = FakeXHR.prototype.open;
    const originalSetRequestHeader = FakeXHR.prototype.setRequestHeader;
    const previous = globalThis.unsafeWindow;
    globalThis.unsafeWindow = {
      fetch: jest.fn(),
      XMLHttpRequest: FakeXHR,
    };

    try {
      createAuth(storage).setupMonitoring();
      FakeXHR.prototype.open = function pageOpen(...args) { return originalOpen.apply(this, args); };
      FakeXHR.prototype.setRequestHeader = function pageSetRequestHeader(...args) {
        return originalSetRequestHeader.apply(this, args);
      };
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));

      const request = new FakeXHR();
      request.open('GET', 'https://app.pcfinancial.ca/inet/banking/v2.0/accounts/abc/posted-transactions');
      request.setRequestHeader('Authorization', 'Bearer sample');
      request.send();

      expect(getSession(storage)?.accountIds).toEqual(['abc']);
    } finally {
      globalThis.unsafeWindow = previous;
    }
  });
});
