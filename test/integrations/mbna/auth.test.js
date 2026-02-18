/**
 * Tests for MBNA Auth Module
 *
 * MBNA uses HttpOnly cookies (JSESSIONID) that can't be read from JS.
 * The auth module simply provides a marker interface  actual auth
 * validation happens via the API probe call.
 */

import { createAuth } from '../../../src/integrations/mbna/source/auth';

describe('MBNA Auth', () => {
  let auth;

  beforeEach(() => {
    auth = createAuth();
  });

  describe('checkStatus', () => {
    it('should always return authenticated true (HttpOnly cookies cant be checked)', () => {
      const status = auth.checkStatus();

      expect(status.authenticated).toBe(true);
    });

    it('should return an object with authenticated property', () => {
      const status = auth.checkStatus();

      expect(status).toHaveProperty('authenticated');
      expect(typeof status.authenticated).toBe('boolean');
    });
  });

  describe('getCredentials', () => {
    it('should return a truthy object (cookies are auto-managed)', () => {
      const creds = auth.getCredentials();

      expect(creds).toBeTruthy();
    });

    it('should indicate cookies are auto-managed by GM_xmlhttpRequest', () => {
      const creds = auth.getCredentials();

      expect(creds.autoManaged).toBe(true);
    });

    it('should never return null (always has credentials via auto-management)', () => {
      const creds = auth.getCredentials();

      expect(creds).not.toBeNull();
      expect(creds).not.toBeUndefined();
    });
  });
});