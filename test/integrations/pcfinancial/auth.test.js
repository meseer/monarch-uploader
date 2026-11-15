import { createAuth, readSessionCredentials } from '../../../src/integrations/pcfinancial/source/auth';

describe('PC Financial auth', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('reads access token, CSRF token, and correlation ID from sessionStorage', () => {
    window.sessionStorage.setItem('CREDENTIALS', JSON.stringify({
      access_token: 'access-123',
      x_pcf_csrf_token: 'csrf-456',
      token_type: 'Bearer',
    }));
    window.sessionStorage.setItem('UVCRLID', '"corr-789"');

    expect(readSessionCredentials()).toEqual({
      accessToken: 'access-123',
      csrfToken: 'csrf-456',
      correlationId: 'corr-789',
    });

    const auth = createAuth();
    expect(auth.checkStatus()).toEqual({ authenticated: true });
    expect(auth.getCredentials()).toEqual({
      accessToken: 'access-123',
      csrfToken: 'csrf-456',
      correlationId: 'corr-789',
    });
  });

  it('returns null when CREDENTIALS is absent or missing required tokens', () => {
    const auth = createAuth();
    expect(auth.checkStatus()).toEqual({ authenticated: false });
    expect(auth.getCredentials()).toBeNull();

    window.sessionStorage.setItem('CREDENTIALS', JSON.stringify({ access_token: 'only-access' }));
    expect(readSessionCredentials()).toBeNull();

    window.sessionStorage.setItem('CREDENTIALS', 'not-valid-json');
    expect(readSessionCredentials()).toBeNull();
  });

  it('handles missing correlation ID gracefully and keeps clearCredentials as a safe no-op', () => {
    window.sessionStorage.setItem('CREDENTIALS', JSON.stringify({
      access_token: 'access-123',
      x_pcf_csrf_token: 'csrf-456',
    }));

    expect(readSessionCredentials()).toEqual({
      accessToken: 'access-123',
      csrfToken: 'csrf-456',
      correlationId: null,
    });

    const auth = createAuth();
    expect(() => auth.clearCredentials()).not.toThrow();
    expect(window.sessionStorage.getItem('CREDENTIALS')).toBeTruthy();
  });
});
