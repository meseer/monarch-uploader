import type { StorageAdapter } from '../../../core/storageAdapter';
import { getSession, saveSession, SESSION_KEY } from './session';

const ACCOUNT_URL = /^https:\/\/app\.pcfinancial\.ca\/inet\/banking\/v2\.0\/accounts\/([^/?#]+)\//;
const HEADER_NAMES = new Set([
  'authorization', 'x-pcf-csrf-token', 'mcid', 'fingerprint', 'groupid',
  'x-nonce', 'channel-timezone-name', 'language', 'uservice-api-version',
  'uservice-channel-type', 'uservice-correlation-id',
  'uservice-message-id', 'uservice-traceability-id',
]);

type PageWindow = Window & typeof globalThis;

/** Extract only the headers needed to replay the observed account request. */
export function captureHeaders(input: HeadersInit | undefined): Record<string, string> {
  if (!input) return {};
  const headers = new Headers(input);
  const captured: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (HEADER_NAMES.has(name.toLowerCase())) captured[name.toLowerCase()] = value;
  });
  return captured;
}

/** Parse an account URL without accepting requests to other origins. */
export function accountIdFromUrl(url: string): string | null {
  const match = new URL(url, window.location.href).href.match(ACCOUNT_URL);
  return match ? decodeURIComponent(match[1]) : null;
}

/** Capture auth headers from successful page fetch and XHR requests. */
export function createAuth(storage: StorageAdapter) {
  let monitoring = false;
  let monitoredFetch: PageWindow['fetch'] | null = null;
  let monitoredOpen: unknown = null;
  let monitoredSetRequestHeader: unknown = null;
  const requests = new WeakMap<XMLHttpRequest, { url: string; headers: Record<string, string> }>();

  function record(url: string, headers: Record<string, string>): void {
    const accountId = accountIdFromUrl(url);
    if (accountId && headers.authorization) saveSession(storage, accountId, headers);
  }

  return {
    setupMonitoring(): void {
      if (monitoring) return;
      monitoring = true;

      const page = (globalThis as typeof globalThis & { unsafeWindow: PageWindow }).unsafeWindow;
      const installMonitoring = (): void => {
        if (page.fetch !== monitoredFetch) {
          const originalFetch = page.fetch;
          const interceptedFetch = async function interceptedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
            const response = await originalFetch.call(this, input, init);
            if (response.ok) {
              const request = input as Request;
              const url = typeof input === 'string' ? input : request.url || String(input);
              const headers = captureHeaders(init?.headers ?? request.headers);
              record(url, headers);
            }
            return response;
          };
          page.fetch = interceptedFetch;
          monitoredFetch = interceptedFetch;
        }

        const OriginalXHR = page.XMLHttpRequest;
        if (OriginalXHR.prototype.open !== monitoredOpen) {
          const originalOpen = OriginalXHR.prototype.open;
          const interceptedOpen = function interceptedOpen(method: string, url: string | URL, ...args: unknown[]): void {
            requests.set(this, { url: String(url), headers: {} });
            originalOpen.call(this, method, url, ...(args as [boolean, string?, string?]));
            this.addEventListener('loadend', () => {
              const request = requests.get(this);
              if (this.status >= 200 && this.status < 300 && request) record(request.url, request.headers);
            });
          };
          OriginalXHR.prototype.open = interceptedOpen;
          monitoredOpen = interceptedOpen;
        }

        if (OriginalXHR.prototype.setRequestHeader !== monitoredSetRequestHeader) {
          const originalSetRequestHeader = OriginalXHR.prototype.setRequestHeader;
          const interceptedSetRequestHeader = function interceptedSetRequestHeader(name: string, value: string): void {
            const request = requests.get(this);
            if (request && HEADER_NAMES.has(name.toLowerCase())) request.headers[name.toLowerCase()] = value;
            originalSetRequestHeader.call(this, name, value);
          };
          OriginalXHR.prototype.setRequestHeader = interceptedSetRequestHeader;
          monitoredSetRequestHeader = interceptedSetRequestHeader;
        }
      };

      installMonitoring();
      document.addEventListener('DOMContentLoaded', installMonitoring, { capture: true, once: true });
    },
    checkStatus(): { authenticated: boolean } {
      return { authenticated: Boolean(getSession(storage)?.headers.authorization) };
    },
    getCredentials(): Record<string, unknown> | null {
      return getSession(storage)?.headers ?? null;
    },
    clearCredentials(): void {
      storage.delete(SESSION_KEY);
    },
    pollingInterval: null,
  };
}
