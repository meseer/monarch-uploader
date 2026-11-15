/**
 * PC Financial authentication helper.
 *
 * Reads the active session credentials directly from `sessionStorage` on
 * `https://secure.pcfinancial.ca` when needed. Nothing is written to or cached
 * in userscript storage (ADR-010).
 *
 * @module integrations/pcfinancial/source/auth
 */

export interface PcFinancialCredentials {
  accessToken: string;
  csrfToken: string;
  correlationId: string | null;
}

interface RawStoredCredentials {
  access_token?: unknown;
  x_pcf_csrf_token?: unknown;
}

const CREDENTIALS_STORAGE_KEY = 'CREDENTIALS';
const CORRELATION_ID_STORAGE_KEY = 'UVCRLID';

/**
 * Normalize a value read from `sessionStorage`, stripping surrounding JSON
 * quotes if the site stored a JSON-encoded string.
 *
 * @param raw - Raw string from `sessionStorage`
 * @returns Trimmed non-empty string, or null
 */
function normalizeStorageString(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^"(.*)"$/, '$1').trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read the current PC Financial credentials from the page's `sessionStorage`.
 *
 * @returns Credentials object when both access and CSRF tokens are present, or null
 */
export function readSessionCredentials(): PcFinancialCredentials | null {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }

  let rawCredentials: string | null;
  let rawCorrelationId: string | null;
  try {
    rawCredentials = window.sessionStorage.getItem(CREDENTIALS_STORAGE_KEY);
    rawCorrelationId = window.sessionStorage.getItem(CORRELATION_ID_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!rawCredentials) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawCredentials) as RawStoredCredentials;
    const accessToken = typeof parsed?.access_token === 'string' ? parsed.access_token.trim() : '';
    const csrfToken = typeof parsed?.x_pcf_csrf_token === 'string' ? parsed.x_pcf_csrf_token.trim() : '';
    if (!accessToken || !csrfToken) {
      return null;
    }

    return {
      accessToken,
      csrfToken,
      correlationId: normalizeStorageString(rawCorrelationId),
    };
  } catch {
    return null;
  }
}

/**
 * Create the PC Financial auth handler for the integration registry.
 *
 * @returns IntegrationAuth implementation
 */
export function createAuth() {
  return {
    checkStatus(): { authenticated: boolean } {
      return { authenticated: readSessionCredentials() !== null };
    },
    getCredentials(): Record<string, unknown> | null {
      const credentials = readSessionCredentials();
      return credentials ? { ...credentials } : null;
    },
    clearCredentials(): void {
      // Credentials live in the institution's own sessionStorage and are read-only.
    },
    pollingInterval: null,
  };
}

export default { createAuth, readSessionCredentials };
