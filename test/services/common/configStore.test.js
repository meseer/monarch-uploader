/**
 * Tests for configStore service
 */

import {
  getConfigStorageKey,
  getConfig,
  saveConfig,
  updateConfigSection,
  getAuth,
  setAuth,
  clearAuth,
  getSettings,
  getSetting,
  setSetting,
  getCategoryMappings,
  saveCategoryMappings,
  getCategoryMapping,
  setCategoryMapping,
  deleteCategoryMapping,
  clearCategoryMappings,
  getHoldingsMappings,
  saveHoldingsMappings,
  getHoldingMapping,
  saveHoldingMapping,
  deleteHoldingMapping,
  clearHoldingsMappings,
  hasConfig,
  deleteLegacyKeys,
} from '../../../src/services/common/configStore';

describe('configStore', () => {
  let gmStore;

  beforeEach(() => {
    jest.clearAllMocks();
    // Set up in-memory GM storage for realistic testing
    gmStore = {};
    GM_getValue.mockImplementation((key, defaultValue) => {
      return key in gmStore ? gmStore[key] : defaultValue;
    });
    GM_setValue.mockImplementation((key, value) => {
      gmStore[key] = value;
    });
    GM_deleteValue.mockImplementation((key) => {
      delete gmStore[key];
    });
    GM_listValues.mockImplementation(() => Object.keys(gmStore));
  });

  // ============================================
  // CORE CONFIG OPERATIONS
  // ============================================

  describe('getConfigStorageKey', () => {
    it('returns storage key for wealthsimple', () => {
      expect(getConfigStorageKey('wealthsimple')).toBe('wealthsimple_config');
    });

    it('returns storage key for questrade', () => {
      expect(getConfigStorageKey('questrade')).toBe('questrade_config');
    });

    it('returns storage key for canadalife', () => {
      expect(getConfigStorageKey('canadalife')).toBe('canadalife_config');
    });

    it('returns storage key for rogersbank', () => {
      expect(getConfigStorageKey('rogersbank')).toBe('rogersbank_config');
    });

    it('returns null for unknown integration', () => {
      expect(getConfigStorageKey('unknown')).toBeNull();
    });
  });

  describe('getConfig / saveConfig', () => {
    it('returns empty object when no config exists', () => {
      expect(getConfig('wealthsimple')).toEqual({});
    });

    it('returns empty object for unknown integration', () => {
      expect(getConfig('unknown')).toEqual({});
    });

    it('saves and retrieves config', () => {
      const config = {
        auth: { token: 'abc123' },
        settings: { lookbackDays: 7 },
      };
      saveConfig('wealthsimple', config);
      expect(getConfig('wealthsimple')).toEqual(config);
    });

    it('returns false when saving for unknown integration', () => {
      expect(saveConfig('unknown', {})).toBe(false);
    });

    it('returns true on successful save', () => {
      expect(saveConfig('wealthsimple', { auth: {} })).toBe(true);
    });

    it('handles corrupted JSON gracefully', () => {
      GM_setValue('wealthsimple_config', 'not-json');
      expect(getConfig('wealthsimple')).toEqual({});
    });
  });

  describe('updateConfigSection', () => {
    it('creates section if it does not exist', () => {
      updateConfigSection('wealthsimple', 'auth', { token: 'abc' });
      const config = getConfig('wealthsimple');
      expect(config.auth).toEqual({ token: 'abc' });
    });

    it('merges into existing section without overwriting other keys', () => {
      saveConfig('wealthsimple', {
        auth: { token: 'abc', identityId: 'id1' },
      });
      updateConfigSection('wealthsimple', 'auth', { token: 'xyz' });
      const config = getConfig('wealthsimple');
      expect(config.auth).toEqual({ token: 'xyz', identityId: 'id1' });
    });

    it('does not affect other sections', () => {
      saveConfig('wealthsimple', {
        auth: { token: 'abc' },
        settings: { lookbackDays: 7 },
      });
      updateConfigSection('wealthsimple', 'auth', { token: 'xyz' });
      const config = getConfig('wealthsimple');
      expect(config.settings).toEqual({ lookbackDays: 7 });
    });
  });

  // ============================================
  // AUTH OPERATIONS
  // ============================================

  describe('auth operations', () => {
    it('getAuth returns empty object when no auth exists', () => {
      expect(getAuth('wealthsimple')).toEqual({});
    });

    it('setAuth saves and getAuth retrieves auth data', () => {
      setAuth('wealthsimple', {
        accessToken: 'token123',
        identityId: 'id456',
        expiresAt: '2025-01-01',
      });
      const auth = getAuth('wealthsimple');
      expect(auth.accessToken).toBe('token123');
      expect(auth.identityId).toBe('id456');
      expect(auth.expiresAt).toBe('2025-01-01');
    });

    it('setAuth merges with existing auth data', () => {
      setAuth('wealthsimple', { accessToken: 'old', identityId: 'id1' });
      setAuth('wealthsimple', { accessToken: 'new' });
      const auth = getAuth('wealthsimple');
      expect(auth.accessToken).toBe('new');
      expect(auth.identityId).toBe('id1');
    });

    it('clearAuth removes auth section', () => {
      setAuth('wealthsimple', { accessToken: 'token' });
      clearAuth('wealthsimple');
      expect(getAuth('wealthsimple')).toEqual({});
    });

    it('clearAuth preserves other sections', () => {
      saveConfig('wealthsimple', {
        auth: { token: 'abc' },
        settings: { lookbackDays: 7 },
      });
      clearAuth('wealthsimple');
      const config = getConfig('wealthsimple');
      expect(config.auth).toBeUndefined();
      expect(config.settings).toEqual({ lookbackDays: 7 });
    });
  });

  // ============================================
  // SETTINGS OPERATIONS
  // ============================================

  describe('settings operations', () => {
    it('getSettings returns empty object when no settings exist', () => {
      expect(getSettings('questrade')).toEqual({});
    });

    it('getSetting returns default when key is not set', () => {
      expect(getSetting('questrade', 'lookbackDays', 7)).toBe(7);
    });

    it('getSetting returns stored value over default', () => {
      setSetting('questrade', 'lookbackDays', 14);
      expect(getSetting('questrade', 'lookbackDays', 7)).toBe(14);
    });

    it('getSetting handles value of 0 correctly', () => {
      setSetting('questrade', 'lookbackDays', 0);
      expect(getSetting('questrade', 'lookbackDays', 7)).toBe(0);
    });

    it('getSetting handles value of false correctly', () => {
      setSetting('questrade', 'someFlag', false);
      expect(getSetting('questrade', 'someFlag', true)).toBe(false);
    });

    it('setSetting preserves other settings', () => {
      setSetting('questrade', 'lookbackDays', 7);
      setSetting('questrade', 'retentionDays', 91);
      const settings = getSettings('questrade');
      expect(settings.lookbackDays).toBe(7);
      expect(settings.retentionDays).toBe(91);
    });
  });

  // ============================================
  // CATEGORY MAPPINGS OPERATIONS
  // ============================================

  describe('category mappings operations', () => {
    it('getCategoryMappings returns empty object when none exist', () => {
      expect(getCategoryMappings('rogersbank')).toEqual({});
    });

    it('saveCategoryMappings and getCategoryMappings round-trip', () => {
      const mappings = {
        'GROCERY STORE': 'Groceries',
        'GAS STATION': 'Auto & Transport',
      };
      saveCategoryMappings('rogersbank', mappings);
      expect(getCategoryMappings('rogersbank')).toEqual(mappings);
    });

    it('getCategoryMapping returns specific mapping', () => {
      saveCategoryMappings('wealthsimple', { 'AMAZON.CA': 'Shopping' });
      expect(getCategoryMapping('wealthsimple', 'AMAZON.CA')).toBe('Shopping');
    });

    it('getCategoryMapping returns null for missing key', () => {
      expect(getCategoryMapping('wealthsimple', 'NONEXISTENT')).toBeNull();
    });

    it('setCategoryMapping adds a new mapping', () => {
      setCategoryMapping('rogersbank', 'RESTAURANT', 'Food & Dining');
      expect(getCategoryMapping('rogersbank', 'RESTAURANT')).toBe('Food & Dining');
    });

    it('setCategoryMapping updates existing mapping', () => {
      setCategoryMapping('rogersbank', 'RESTAURANT', 'Food & Dining');
      setCategoryMapping('rogersbank', 'RESTAURANT', 'Restaurants');
      expect(getCategoryMapping('rogersbank', 'RESTAURANT')).toBe('Restaurants');
    });

    it('deleteCategoryMapping removes a mapping', () => {
      setCategoryMapping('rogersbank', 'A', 'Cat A');
      setCategoryMapping('rogersbank', 'B', 'Cat B');
      deleteCategoryMapping('rogersbank', 'A');
      expect(getCategoryMapping('rogersbank', 'A')).toBeNull();
      expect(getCategoryMapping('rogersbank', 'B')).toBe('Cat B');
    });

    it('clearCategoryMappings removes all mappings', () => {
      setCategoryMapping('rogersbank', 'A', 'Cat A');
      setCategoryMapping('rogersbank', 'B', 'Cat B');
      clearCategoryMappings('rogersbank');
      expect(getCategoryMappings('rogersbank')).toEqual({});
    });

    it('category operations preserve other config sections', () => {
      setAuth('wealthsimple', { token: 'abc' });
      setCategoryMapping('wealthsimple', 'MERCHANT', 'Category');
      const config = getConfig('wealthsimple');
      expect(config.auth.token).toBe('abc');
      expect(config.categoryMappings.MERCHANT).toBe('Category');
    });
  });

  // ============================================
  // HOLDINGS MAPPINGS OPERATIONS
  // ============================================

  describe('holdings mappings operations', () => {
    const sampleMapping = {
      securityId: 'monarch-sec-1',
      holdingId: 'monarch-hold-1',
      symbol: 'VFV',
    };

    it('getHoldingsMappings returns empty object when none exist', () => {
      expect(getHoldingsMappings('wealthsimple')).toEqual({});
    });

    it('saveHoldingsMappings and getHoldingsMappings round-trip', () => {
      const mappings = {
        'sec-uuid-1': sampleMapping,
        'sec-uuid-2': { securityId: 's2', holdingId: 'h2', symbol: 'XEQT' },
      };
      saveHoldingsMappings('wealthsimple', mappings);
      expect(getHoldingsMappings('wealthsimple')).toEqual(mappings);
    });

    it('getHoldingMapping returns specific mapping', () => {
      saveHoldingsMappings('questrade', { 'sec-1': sampleMapping });
      expect(getHoldingMapping('questrade', 'sec-1')).toEqual(sampleMapping);
    });

    it('getHoldingMapping returns null for missing key', () => {
      expect(getHoldingMapping('questrade', 'nonexistent')).toBeNull();
    });

    it('saveHoldingMapping adds a new mapping with normalized structure', () => {
      saveHoldingMapping('wealthsimple', 'sec-abc', {
        securityId: 's1',
        holdingId: 'h1',
        symbol: 'VFV',
        extraField: 'ignored',
      });
      expect(getHoldingMapping('wealthsimple', 'sec-abc')).toEqual({
        securityId: 's1',
        holdingId: 'h1',
        symbol: 'VFV',
      });
    });

    it('saveHoldingMapping fills missing fields with null', () => {
      saveHoldingMapping('wealthsimple', 'sec-xyz', { symbol: 'XEQT' });
      expect(getHoldingMapping('wealthsimple', 'sec-xyz')).toEqual({
        securityId: null,
        holdingId: null,
        symbol: 'XEQT',
      });
    });

    it('saveHoldingMapping preserves other mappings', () => {
      saveHoldingMapping('wealthsimple', 'sec-1', sampleMapping);
      saveHoldingMapping('wealthsimple', 'sec-2', { securityId: 's2', holdingId: 'h2', symbol: 'XEQT' });
      expect(getHoldingMapping('wealthsimple', 'sec-1')).toEqual(sampleMapping);
      expect(getHoldingMapping('wealthsimple', 'sec-2')).toBeTruthy();
    });

    it('deleteHoldingMapping removes a mapping', () => {
      saveHoldingMapping('questrade', 'sec-1', sampleMapping);
      saveHoldingMapping('questrade', 'sec-2', { securityId: 's2', holdingId: 'h2', symbol: 'XEQT' });
      const result = deleteHoldingMapping('questrade', 'sec-1');
      expect(result).toBe(true);
      expect(getHoldingMapping('questrade', 'sec-1')).toBeNull();
      expect(getHoldingMapping('questrade', 'sec-2')).toBeTruthy();
    });

    it('deleteHoldingMapping returns false for nonexistent key', () => {
      expect(deleteHoldingMapping('questrade', 'nonexistent')).toBe(false);
    });

    it('clearHoldingsMappings removes all mappings', () => {
      saveHoldingMapping('wealthsimple', 'sec-1', sampleMapping);
      saveHoldingMapping('wealthsimple', 'sec-2', { securityId: 's2', holdingId: 'h2', symbol: 'X' });
      clearHoldingsMappings('wealthsimple');
      expect(getHoldingsMappings('wealthsimple')).toEqual({});
    });

    it('holdings operations preserve other config sections', () => {
      setAuth('wealthsimple', { token: 'abc' });
      setCategoryMapping('wealthsimple', 'M', 'Cat');
      saveHoldingMapping('wealthsimple', 'sec-1', sampleMapping);
      const config = getConfig('wealthsimple');
      expect(config.auth.token).toBe('abc');
      expect(config.categoryMappings.M).toBe('Cat');
      expect(config.holdingsMappings['sec-1']).toEqual(sampleMapping);
    });
  });

  // ============================================
  // MIGRATION HELPERS
  // ============================================

  describe('migration helpers', () => {
    it('hasConfig returns false when no config exists', () => {
      expect(hasConfig('wealthsimple')).toBe(false);
    });

    it('hasConfig returns true when config exists', () => {
      saveConfig('wealthsimple', { auth: { token: 'abc' } });
      expect(hasConfig('wealthsimple')).toBe(true);
    });

    it('hasConfig returns false for empty config object', () => {
      saveConfig('wealthsimple', {});
      expect(hasConfig('wealthsimple')).toBe(false);
    });

    it('deleteLegacyKeys deletes specified keys', () => {
      GM_setValue('legacy_key_1', 'value1');
      GM_setValue('legacy_key_2', 'value2');
      GM_setValue('keep_this', 'value3');

      deleteLegacyKeys(['legacy_key_1', 'legacy_key_2']);

      expect(GM_getValue('legacy_key_1', null)).toBeNull();
      expect(GM_getValue('legacy_key_2', null)).toBeNull();
      expect(GM_getValue('keep_this', null)).toBe('value3');
    });
  });

  // ============================================
  // CROSS-INTEGRATION ISOLATION
  // ============================================

  describe('cross-integration isolation', () => {
    it('configs for different integrations are independent', () => {
      setAuth('wealthsimple', { token: 'ws-token' });
      setAuth('rogersbank', { token: 'rb-token' });
      setSetting('wealthsimple', 'lookbackDays', 7);
      setSetting('rogersbank', 'lookbackDays', 14);

      expect(getAuth('wealthsimple').token).toBe('ws-token');
      expect(getAuth('rogersbank').token).toBe('rb-token');
      expect(getSetting('wealthsimple', 'lookbackDays', 0)).toBe(7);
      expect(getSetting('rogersbank', 'lookbackDays', 0)).toBe(14);
    });

    it('clearing one integration config does not affect another', () => {
      setAuth('wealthsimple', { token: 'ws' });
      setAuth('questrade', { token: 'qt' });
      saveConfig('wealthsimple', {});
      expect(getAuth('questrade').token).toBe('qt');
    });
  });
});