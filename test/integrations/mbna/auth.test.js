/**
 * Tests for MBNA Auth Module
 */

import { createAuth } from '../../../src/integrations/mbna/auth';

describe('MBNA Auth', () => {
  let auth;
  let originalCookie;

  beforeEach(() => {
    originalCookie = Object.getOwnPropertyDescriptor(document, 'cookie');
    auth = createAuth();
  });

  afterEach(() => {
    if (originalCookie) {
      Object.defineProperty(document, 'cookie', originalCookie);
    }
  });

  function mockCookies(cookieString) {
    Object.defineProperty(document, 'cookie', {
      get: () => cookieString,
      configurable: true,
    });
  }

  describe('checkStatus', () => {
    it('should return authenticated when JSESSIONID cookie is present', () => {
      mockCookies('TD-persist=SOC; JSESSIONID=0000589qFTuCYhBIqhQMY-CKW_P:1bm0ishnt; other=value');

      const status = auth.checkStatus();

      expect(status.authenticated).toBe(true);
      expect(status.jsessionId).toBe('0000589qFTuCYhBIqhQMY-CKW_P:1bm0ishnt');
    });

    it('should return not authenticated when JSESSIONID cookie is absent', () => {
      mockCookies('TD-persist=SOC; other=value');

      const status = auth.checkStatus();

      expect(status.authenticated).toBe(false);
      expect(status.jsessionId).toBeNull();
    });

    it('should return not authenticated when cookies are empty', () => {
      mockCookies('');

      const status = auth.checkStatus();

      expect(status.authenticated).toBe(false);
      expect(status.jsessionId).toBeNull();
    });

    it('should handle JSESSIONID as the only cookie', () => {
      mockCookies('JSESSIONID=abc123');

      const status = auth.checkStatus();

      expect(status.authenticated).toBe(true);
      expect(status.jsessionId).toBe('abc123');
    });

    it('should handle JSESSIONID with whitespace', () => {
      mockCookies('  JSESSIONID=session-value-here  ; other=foo');

      const status = auth.checkStatus();

      expect(status.authenticated).toBe(true);
      expect(status.jsessionId).toBe('session-value-here');
    });

    it('should return not authenticated when JSESSIONID has empty value', () => {
      mockCookies('JSESSIONID=; other=value');

      const status = auth.checkStatus();

      expect(status.authenticated).toBe(false);
      expect(status.jsessionId).toBeNull();
    });
  });

  describe('getCredentials', () => {
    it('should return cookie header when authenticated', () => {
      mockCookies('JSESSIONID=test-session-id');

      const creds = auth.getCredentials();

      expect(creds).not.toBeNull();
      expect(creds.jsessionId).toBe('test-session-id');
      expect(creds.cookieHeader).toBe('TD-persist=SOC; JSESSIONID=test-session-id');
    });

    it('should return null when not authenticated', () => {
      mockCookies('other=value');

      const creds = auth.getCredentials();

      expect(creds).toBeNull();
    });

    it('should construct correct cookie header format', () => {
      mockCookies('JSESSIONID=0000589qFTuCYhBIqhQMY-CKW_P:1bm0ishnt');

      const creds = auth.getCredentials();

      expect(creds.cookieHeader).toBe('TD-persist=SOC; JSESSIONID=0000589qFTuCYhBIqhQMY-CKW_P:1bm0ishnt');
    });

    it('should always include TD-persist=SOC prefix', () => {
      mockCookies('JSESSIONID=any-session');

      const creds = auth.getCredentials();

      expect(creds.cookieHeader).toMatch(/^TD-persist=SOC; /);
    });
  });
});