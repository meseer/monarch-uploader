/**
 * Tests for Integration Registry
 * @module test/core/integrationRegistry
 */

import {
  registerIntegration,
  getIntegration,
  getAllIntegrations,
  getAllIntegrationIds,
  getIntegrationForHostname,
  getAllManifests,
  getManifest,
  isRegistered,
  getIntegrationsWithCapability,
  getIntegrationCount,
  unregisterIntegration,
  clearRegistry,
} from '../../src/core/integrationRegistry';

/**
 * Helper to create a minimal valid integration registration object.
 */
function createMockIntegration(overrides = {}) {
  const id = overrides.id || 'test-integration';
  return {
    manifest: {
      id,
      displayName: overrides.displayName || 'Test Integration',
      matchDomains: overrides.matchDomains || ['test.example.com'],
      capabilities: overrides.capabilities || {},
      ...overrides.manifest,
    },
    api: overrides.api || { fetch: jest.fn() },
    auth: overrides.auth || { getToken: jest.fn() },
    enrichment: overrides.enrichment || null,
    injectionPoint: overrides.injectionPoint || { selectors: [] },
    monarchMapper: overrides.monarchMapper || null,
  };
}

describe('integrationRegistry', () => {
  afterEach(() => {
    clearRegistry();
  });

  describe('registerIntegration', () => {
    it('should register a valid integration and return true', () => {
      const integration = createMockIntegration();
      const result = registerIntegration(integration);

      expect(result).toBe(true);
      expect(getIntegrationCount()).toBe(1);
    });

    it('should return false when manifest is missing', () => {
      const result = registerIntegration({
        manifest: null,
        api: {},
        auth: {},
        injectionPoint: {},
      });

      expect(result).toBe(false);
      expect(getIntegrationCount()).toBe(0);
    });

    it('should return false when manifest.id is missing', () => {
      const result = registerIntegration({
        manifest: { displayName: 'No ID' },
        api: {},
        auth: {},
        injectionPoint: {},
      });

      expect(result).toBe(false);
      expect(getIntegrationCount()).toBe(0);
    });

    it('should replace an existing integration with the same id', () => {
      const first = createMockIntegration({ displayName: 'First' });
      const second = createMockIntegration({ displayName: 'Second' });

      registerIntegration(first);
      registerIntegration(second);

      expect(getIntegrationCount()).toBe(1);
      expect(getIntegration('test-integration').manifest.displayName).toBe('Second');
    });

    it('should default enrichment and monarchMapper to null', () => {
      registerIntegration({
        manifest: { id: 'minimal', displayName: 'Minimal' },
        api: {},
        auth: {},
        injectionPoint: {},
      });

      const reg = getIntegration('minimal');
      expect(reg.enrichment).toBeNull();
      expect(reg.monarchMapper).toBeNull();
    });

    it('should store enrichment and monarchMapper when provided', () => {
      const enrichment = { fetchDetails: jest.fn() };
      const monarchMapper = { mapTransactions: jest.fn() };

      registerIntegration({
        manifest: { id: 'full', displayName: 'Full' },
        api: {},
        auth: {},
        enrichment,
        injectionPoint: {},
        monarchMapper,
      });

      const reg = getIntegration('full');
      expect(reg.enrichment).toBe(enrichment);
      expect(reg.monarchMapper).toBe(monarchMapper);
    });
  });

  describe('getIntegration', () => {
    it('should return null for an unregistered id', () => {
      expect(getIntegration('nonexistent')).toBeNull();
    });

    it('should return the registered integration object', () => {
      const integration = createMockIntegration();
      registerIntegration(integration);

      const result = getIntegration('test-integration');
      expect(result).not.toBeNull();
      expect(result.manifest.id).toBe('test-integration');
      expect(result.api).toBe(integration.api);
      expect(result.auth).toBe(integration.auth);
    });
  });

  describe('getAllIntegrations', () => {
    it('should return empty array when no integrations registered', () => {
      expect(getAllIntegrations()).toEqual([]);
    });

    it('should return all registered integrations', () => {
      registerIntegration(createMockIntegration({ id: 'alpha' }));
      registerIntegration(createMockIntegration({ id: 'beta' }));
      registerIntegration(createMockIntegration({ id: 'gamma' }));

      const all = getAllIntegrations();
      expect(all).toHaveLength(3);

      const ids = all.map((i) => i.manifest.id);
      expect(ids).toContain('alpha');
      expect(ids).toContain('beta');
      expect(ids).toContain('gamma');
    });

    it('should return a new array each time (not the internal map)', () => {
      registerIntegration(createMockIntegration({ id: 'one' }));
      const first = getAllIntegrations();
      const second = getAllIntegrations();
      expect(first).not.toBe(second);
      expect(first).toEqual(second);
    });
  });

  describe('getAllIntegrationIds', () => {
    it('should return empty array when no integrations registered', () => {
      expect(getAllIntegrationIds()).toEqual([]);
    });

    it('should return all registered integration IDs', () => {
      registerIntegration(createMockIntegration({ id: 'ws' }));
      registerIntegration(createMockIntegration({ id: 'qt' }));

      const ids = getAllIntegrationIds();
      expect(ids).toHaveLength(2);
      expect(ids).toContain('ws');
      expect(ids).toContain('qt');
    });
  });

  describe('getIntegrationForHostname', () => {
    beforeEach(() => {
      registerIntegration(
        createMockIntegration({
          id: 'wealthsimple',
          matchDomains: ['my.wealthsimple.com'],
        }),
      );
      registerIntegration(
        createMockIntegration({
          id: 'questrade',
          matchDomains: ['my.questrade.com', 'questrade.com'],
        }),
      );
    });

    it('should return null for null hostname', () => {
      expect(getIntegrationForHostname(null)).toBeNull();
    });

    it('should return null for empty hostname', () => {
      expect(getIntegrationForHostname('')).toBeNull();
    });

    it('should return null for unmatched hostname', () => {
      expect(getIntegrationForHostname('www.google.com')).toBeNull();
    });

    it('should match exact domain', () => {
      const result = getIntegrationForHostname('my.wealthsimple.com');
      expect(result).not.toBeNull();
      expect(result.manifest.id).toBe('wealthsimple');
    });

    it('should match when hostname contains the domain', () => {
      const result = getIntegrationForHostname('sub.my.questrade.com');
      expect(result).not.toBeNull();
      expect(result.manifest.id).toBe('questrade');
    });

    it('should match first domain in multi-domain list', () => {
      const result = getIntegrationForHostname('questrade.com');
      expect(result).not.toBeNull();
      expect(result.manifest.id).toBe('questrade');
    });
  });

  describe('getAllManifests', () => {
    it('should return empty array when no integrations registered', () => {
      expect(getAllManifests()).toEqual([]);
    });

    it('should return manifests for all registered integrations', () => {
      registerIntegration(
        createMockIntegration({ id: 'a', displayName: 'Alpha' }),
      );
      registerIntegration(
        createMockIntegration({ id: 'b', displayName: 'Beta' }),
      );

      const manifests = getAllManifests();
      expect(manifests).toHaveLength(2);
      expect(manifests[0].id).toBe('a');
      expect(manifests[1].id).toBe('b');
    });

    it('should return only manifest objects, not full registrations', () => {
      registerIntegration(createMockIntegration({ id: 'test' }));

      const manifests = getAllManifests();
      expect(manifests[0]).not.toHaveProperty('api');
      expect(manifests[0]).not.toHaveProperty('auth');
      expect(manifests[0]).toHaveProperty('id');
      expect(manifests[0]).toHaveProperty('displayName');
    });
  });

  describe('getManifest', () => {
    it('should return null for unregistered integration', () => {
      expect(getManifest('nonexistent')).toBeNull();
    });

    it('should return manifest for registered integration', () => {
      registerIntegration(
        createMockIntegration({ id: 'ws', displayName: 'Wealthsimple' }),
      );

      const manifest = getManifest('ws');
      expect(manifest).not.toBeNull();
      expect(manifest.id).toBe('ws');
      expect(manifest.displayName).toBe('Wealthsimple');
    });
  });

  describe('isRegistered', () => {
    it('should return false for unregistered integration', () => {
      expect(isRegistered('nonexistent')).toBe(false);
    });

    it('should return true for registered integration', () => {
      registerIntegration(createMockIntegration({ id: 'test' }));
      expect(isRegistered('test')).toBe(true);
    });

    it('should return false after unregistering', () => {
      registerIntegration(createMockIntegration({ id: 'test' }));
      unregisterIntegration('test');
      expect(isRegistered('test')).toBe(false);
    });
  });

  describe('getIntegrationsWithCapability', () => {
    beforeEach(() => {
      registerIntegration(
        createMockIntegration({
          id: 'with-tx',
          capabilities: { hasTransactions: true, hasBalance: true },
        }),
      );
      registerIntegration(
        createMockIntegration({
          id: 'with-holdings',
          capabilities: { hasHoldings: true, hasBalance: true },
        }),
      );
      registerIntegration(
        createMockIntegration({
          id: 'minimal',
          capabilities: {},
        }),
      );
    });

    it('should return integrations that have the capability set to true', () => {
      const withBalance = getIntegrationsWithCapability('hasBalance');
      expect(withBalance).toHaveLength(2);

      const ids = withBalance.map((i) => i.manifest.id);
      expect(ids).toContain('with-tx');
      expect(ids).toContain('with-holdings');
    });

    it('should return empty array for unsupported capability', () => {
      expect(getIntegrationsWithCapability('hasCreditLimit')).toEqual([]);
    });

    it('should not include integrations where capability is falsy', () => {
      const withTx = getIntegrationsWithCapability('hasTransactions');
      expect(withTx).toHaveLength(1);
      expect(withTx[0].manifest.id).toBe('with-tx');
    });

    it('should not include integrations with empty capabilities', () => {
      const withHoldings = getIntegrationsWithCapability('hasHoldings');
      expect(withHoldings).toHaveLength(1);
      expect(withHoldings[0].manifest.id).toBe('with-holdings');
    });
  });

  describe('getIntegrationCount', () => {
    it('should return 0 for empty registry', () => {
      expect(getIntegrationCount()).toBe(0);
    });

    it('should return correct count after registrations', () => {
      registerIntegration(createMockIntegration({ id: 'a' }));
      registerIntegration(createMockIntegration({ id: 'b' }));
      expect(getIntegrationCount()).toBe(2);
    });

    it('should not double-count replaced registrations', () => {
      registerIntegration(createMockIntegration({ id: 'same' }));
      registerIntegration(createMockIntegration({ id: 'same' }));
      expect(getIntegrationCount()).toBe(1);
    });
  });

  describe('unregisterIntegration', () => {
    it('should return true and remove a registered integration', () => {
      registerIntegration(createMockIntegration({ id: 'target' }));
      expect(unregisterIntegration('target')).toBe(true);
      expect(getIntegration('target')).toBeNull();
      expect(getIntegrationCount()).toBe(0);
    });

    it('should return false for an unregistered integration', () => {
      expect(unregisterIntegration('nonexistent')).toBe(false);
    });

    it('should not affect other registered integrations', () => {
      registerIntegration(createMockIntegration({ id: 'keep' }));
      registerIntegration(createMockIntegration({ id: 'remove' }));

      unregisterIntegration('remove');

      expect(getIntegration('keep')).not.toBeNull();
      expect(getIntegration('remove')).toBeNull();
      expect(getIntegrationCount()).toBe(1);
    });
  });

  describe('clearRegistry', () => {
    it('should remove all registered integrations', () => {
      registerIntegration(createMockIntegration({ id: 'a' }));
      registerIntegration(createMockIntegration({ id: 'b' }));
      registerIntegration(createMockIntegration({ id: 'c' }));

      clearRegistry();

      expect(getIntegrationCount()).toBe(0);
      expect(getAllIntegrations()).toEqual([]);
      expect(getIntegration('a')).toBeNull();
    });

    it('should allow re-registration after clearing', () => {
      registerIntegration(createMockIntegration({ id: 'a' }));
      clearRegistry();

      registerIntegration(createMockIntegration({ id: 'b' }));
      expect(getIntegrationCount()).toBe(1);
      expect(isRegistered('b')).toBe(true);
      expect(isRegistered('a')).toBe(false);
    });
  });
});