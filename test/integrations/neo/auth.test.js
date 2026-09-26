import { createAuth } from '../../../src/integrations/neo/source/auth';

describe('Neo auth handler', () => {
  it('uses the browser-managed session cookie', () => {
    const auth = createAuth();

    expect(auth.checkStatus()).toEqual({ authenticated: true });
    expect(auth.getCredentials()).toEqual({ autoManaged: true });
  });
});
