/**
 * Tests for Legacy Storage Migration
 */

import {
  migrateAllLegacyStorage,
  migrateRogersBankAuth,
  migrateLookbackDays,
  migrateCategoryMappings,
  cleanupWealthsimpleLegacyAuth,
} from '../../../src/services/common/legacyMigration';

// Mock dependencies
jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/core/config', () => ({
  STORAGE: {
    // Rogers Bank auth
    ROGERSBANK_AUTH_TOKEN: 'rogersbank_auth_token',
    ROGERSBANK_ACCOUNT_ID: 'rogersbank_account_id',
    ROGERSBANK_CUSTOMER_ID: 'rogersbank_customer_id',
    ROGERSBANK_ACCOUNT_ID_ENCODED: 'rogersbank_account_id_encoded',
    ROGERSBANK_CUSTOMER_ID_ENCODED: 'rogersbank_customer_id_encoded',
    ROGERSBANK_DEVICE_ID: 'rogersbank_device_id',
    ROGERSBANK_LAST_UPDATED: 'rogersbank_last_updated',
    // Lookback days
    WEALTHSIMPLE_LOOKBACK_DAYS: 'wealthsimple_lookback_days',
    ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
    QUESTRADE_LOOKBACK_DAYS: 'questrade_lookback_days',
    CANADALIFE_LOOKBACK_DAYS: 'canadalife_lookback_days',
    // Category mappings
    ROGERSBANK_CATEGORY_MAPPINGS: 'rogersbank_category_mappings',
    WEALTHSIMPLE_CATEGORY_MAPPINGS: 'wealthsimple_category_mappings',
    // Wealthsimple auth (legacy)
    WEALTHSIMPLE_AUTH_TOKEN: 'wealthsimple_auth_token',
    WEALTHSIMPLE_ACCESS_TOKEN: 'wealthsimple_access_token',
    WEALTHSIMPLE_IDENTITY_ID: 'wealthsimple_identity_id',
    WEALTHSIMPLE_TOKEN_EXPIRES_AT: 'wealthsimple_token_expires_at',
    WEALTHSIMPLE_INVEST_PROFILE: 'wealthsimple_invest_profile',
    WEALTHSIMPLE_TRADE_PROFILE: 'wealthsimple_trade_profile',
    // Config store keys
    WEALTHSIMPLE_CONFIG: 'wealthsimple_config',
    QUESTRADE_CONFIG: 'questrade_config',
    CANADALIFE_CONFIG: 'canadalife_config',
    ROGERSBANK_CONFIG: 'rogersbank_config',
  },
  TRANSACTION_RETENTION_DEFAULTS: { DAYS: 91, COUNT: 1000 },
}));

jest.mock('../../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: {
    WEALTHSIMPLE: 'wealthsimple',
    QUESTRADE: 'questrade',
    CANADALIFE: 'canadalife',
    ROGERSBANK: 'rogersbank',
  },
}));

// Mock configStore — track calls via simple in-memory store
const mockConfigData = {};

jest.mock('../../../src/services/common/configStore', () => ({
  getAuth: jest.fn((id) => {
    const config = mockConfigData[`${id}_config`];
    return config?.auth || {};
  }),
  setAuth: jest.fn((id, data) => {
    if (!mockConfigData[`${id}_config`]) mockConfigData[`${id}_config`] = {};
    mockConfigData[`${id}_config`].auth = { ...(mockConfigData[`${id}_config`].auth || {}), ...data };
  }),
  getSetting: jest.fn((id, key, defaultVal) => {
    const config = mockConfigData[`${id}_config`];
    return config?.settings?.[key] !== undefined ? config.settings[key] : defaultVal;
  }),
  setSetting: jest.fn((id, key, value) => {
    if (!mockConfigData[`${id}_config`]) mockConfigData[`${id}_config`] = {};
    if (!mockConfigData[`${id}_config`].settings) mockConfigData[`${id}_config`].settings = {};
    mockConfigData[`${id}_config`].settings[key] = value;
  }),
  getCategoryMappings: jest.fn((id) => {
    const config = mockConfigData[`${id}_config`];
    return config?.categoryMappings || {};
  }),
  saveCategoryMappings: jest.fn((id, mappings) => {
    if (!mockConfigData[`${id}_config`]) mockConfigData[`${id}_config`] = {};
    mockConfigData[`${id}_config`].categoryMappings = mappings;
  }),
}));

// Mock GM functions
globalThis.GM_getValue = jest.fn();
globalThis.GM_setValue = jest.fn();
globalThis.GM_deleteValue = jest.fn();

// Import mocks for assertions
const configStore = require('../../../src/services/common/configStore');

describe('Legacy Storage Migration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Clear mock config data
    Object.keys(mockConfigData).forEach((key) => delete mockConfigData[key]);
    // Default: no legacy data
    globalThis.GM_getValue.mockReturnValue(undefined);
  });

  describe('migrateRogersBankAuth', () => {
    test('should skip when no legacy auth token exists', () => {
      GM_getValue.mockReturnValue(null);

      const deleted = migrateRogersBankAuth();

      expect(deleted).toBe(0);
      expect(configStore.setAuth).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
    });

    test('should migrate legacy auth to configStore when configStore is empty', () => {
      GM_getValue.mockImplementation((key) => {
        const data = {
          rogersbank_auth_token: 'test-token',
          rogersbank_account_id: 'acc-123',
          rogersbank_customer_id: 'cust-456',
          rogersbank_account_id_encoded: 'enc-acc',
          rogersbank_customer_id_encoded: 'enc-cust',
          rogersbank_device_id: 'dev-789',
          rogersbank_last_updated: '2024-01-01',
        };
        return data[key] ?? null;
      });

      const deleted = migrateRogersBankAuth();

      expect(deleted).toBe(7);
      expect(configStore.setAuth).toHaveBeenCalledWith('rogersbank', {
        authToken: 'test-token',
        accountId: 'acc-123',
        customerId: 'cust-456',
        accountIdEncoded: 'enc-acc',
        customerIdEncoded: 'enc-cust',
        deviceId: 'dev-789',
        lastUpdated: '2024-01-01',
      });
      expect(GM_deleteValue).toHaveBeenCalledTimes(7);
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_auth_token');
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_account_id');
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_device_id');
    });

    test('should delete legacy keys even when configStore already has auth', () => {
      // configStore already has auth
      mockConfigData.rogersbank_config = {
        auth: { authToken: 'existing-token', accountId: 'existing-acc' },
      };

      GM_getValue.mockImplementation((key) => {
        if (key === 'rogersbank_auth_token') return 'old-token';
        return null;
      });

      const deleted = migrateRogersBankAuth();

      expect(deleted).toBe(7);
      // Should NOT overwrite configStore
      expect(configStore.setAuth).not.toHaveBeenCalled();
      // Should still delete legacy keys
      expect(GM_deleteValue).toHaveBeenCalledTimes(7);
    });

    test('should handle errors gracefully', () => {
      GM_getValue.mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => migrateRogersBankAuth()).not.toThrow();
    });
  });

  describe('migrateLookbackDays', () => {
    test('should skip when no legacy lookback keys exist', () => {
      GM_getValue.mockReturnValue(undefined);

      const deleted = migrateLookbackDays();

      expect(deleted).toBe(0);
      expect(configStore.setSetting).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
    });

    test('should migrate a single legacy lookback key', () => {
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'wealthsimple_lookback_days') return 14;
        return defaultVal;
      });

      const deleted = migrateLookbackDays();

      expect(deleted).toBe(1);
      expect(configStore.setSetting).toHaveBeenCalledWith('wealthsimple', 'lookbackDays', 14);
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_lookback_days');
    });

    test('should migrate all four lookback keys when all exist', () => {
      GM_getValue.mockImplementation((key, defaultVal) => {
        const data = {
          wealthsimple_lookback_days: 7,
          rogersbank_lookback_days: 14,
          questrade_lookback_days: 0,
          canadalife_lookback_days: 1,
        };
        return data[key] !== undefined ? data[key] : defaultVal;
      });

      const deleted = migrateLookbackDays();

      expect(deleted).toBe(4);
      expect(configStore.setSetting).toHaveBeenCalledWith('wealthsimple', 'lookbackDays', 7);
      expect(configStore.setSetting).toHaveBeenCalledWith('rogersbank', 'lookbackDays', 14);
      expect(configStore.setSetting).toHaveBeenCalledWith('questrade', 'lookbackDays', 0);
      expect(configStore.setSetting).toHaveBeenCalledWith('canadalife', 'lookbackDays', 1);
      expect(GM_deleteValue).toHaveBeenCalledTimes(4);
    });

    test('should not overwrite configStore when it already has a value', () => {
      mockConfigData.wealthsimple_config = {
        settings: { lookbackDays: 30 },
      };

      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'wealthsimple_lookback_days') return 7;
        return defaultVal;
      });

      const deleted = migrateLookbackDays();

      expect(deleted).toBe(1); // Still deletes legacy key
      expect(configStore.setSetting).not.toHaveBeenCalled(); // Does not overwrite
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_lookback_days');
    });

    test('should handle errors for individual keys without stopping', () => {
      let callCount = 0;
      GM_getValue.mockImplementation((key, defaultVal) => {
        callCount++;
        if (key === 'wealthsimple_lookback_days') throw new Error('Storage error');
        if (key === 'rogersbank_lookback_days') return 14;
        return defaultVal;
      });

      const deleted = migrateLookbackDays();

      // Should still process rogersbank even though wealthsimple failed
      expect(deleted).toBe(1);
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_lookback_days');
    });
  });

  describe('migrateCategoryMappings', () => {
    test('should skip when no legacy category mapping keys exist', () => {
      GM_getValue.mockReturnValue(undefined);

      const deleted = migrateCategoryMappings();

      expect(deleted).toBe(0);
      expect(configStore.saveCategoryMappings).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
    });

    test('should migrate Rogers Bank category mappings', () => {
      const mappings = { RESTAURANTS: 'Dining', GAS: 'Transportation' };

      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_category_mappings') return JSON.stringify(mappings);
        return defaultVal;
      });

      const deleted = migrateCategoryMappings();

      expect(deleted).toBe(1);
      expect(configStore.saveCategoryMappings).toHaveBeenCalledWith('rogersbank', mappings);
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_category_mappings');
    });

    test('should migrate Wealthsimple category mappings', () => {
      const mappings = { STARBUCKS: 'Dining', UBER: 'Transportation' };

      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'wealthsimple_category_mappings') return JSON.stringify(mappings);
        return defaultVal;
      });

      const deleted = migrateCategoryMappings();

      expect(deleted).toBe(1);
      expect(configStore.saveCategoryMappings).toHaveBeenCalledWith('wealthsimple', mappings);
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_category_mappings');
    });

    test('should migrate both Rogers Bank and Wealthsimple mappings', () => {
      const rbMappings = { RESTAURANTS: 'Dining' };
      const wsMappings = { STARBUCKS: 'Dining' };

      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_category_mappings') return JSON.stringify(rbMappings);
        if (key === 'wealthsimple_category_mappings') return JSON.stringify(wsMappings);
        return defaultVal;
      });

      const deleted = migrateCategoryMappings();

      expect(deleted).toBe(2);
      expect(configStore.saveCategoryMappings).toHaveBeenCalledWith('rogersbank', rbMappings);
      expect(configStore.saveCategoryMappings).toHaveBeenCalledWith('wealthsimple', wsMappings);
    });

    test('should not overwrite configStore when it already has mappings', () => {
      mockConfigData.rogersbank_config = {
        categoryMappings: { EXISTING: 'Category' },
      };

      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_category_mappings') return JSON.stringify({ OLD: 'Mapping' });
        return defaultVal;
      });

      const deleted = migrateCategoryMappings();

      expect(deleted).toBe(1); // Still deletes legacy key
      expect(configStore.saveCategoryMappings).not.toHaveBeenCalled(); // Does not overwrite
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_category_mappings');
    });

    test('should delete legacy key even when legacy data is empty object', () => {
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_category_mappings') return '{}';
        return defaultVal;
      });

      const deleted = migrateCategoryMappings();

      expect(deleted).toBe(1);
      expect(configStore.saveCategoryMappings).not.toHaveBeenCalled(); // Empty, no need to migrate
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_category_mappings');
    });

    test('should handle invalid JSON in legacy key', () => {
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_category_mappings') return 'invalid json';
        return defaultVal;
      });

      const deleted = migrateCategoryMappings();

      expect(deleted).toBe(1); // Deletes the corrupt key
      expect(configStore.saveCategoryMappings).not.toHaveBeenCalled();
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_category_mappings');
    });
  });

  describe('cleanupWealthsimpleLegacyAuth', () => {
    test('should skip when no legacy Wealthsimple auth keys exist', () => {
      GM_getValue.mockReturnValue(undefined);

      const deleted = cleanupWealthsimpleLegacyAuth();

      expect(deleted).toBe(0);
      expect(GM_deleteValue).not.toHaveBeenCalled();
    });

    test('should delete all existing Wealthsimple legacy auth keys', () => {
      GM_getValue.mockImplementation((key) => {
        const data = {
          wealthsimple_auth_token: 'old-token',
          wealthsimple_access_token: 'old-access',
          wealthsimple_identity_id: 'old-identity',
          wealthsimple_token_expires_at: '2024-01-01',
          wealthsimple_invest_profile: 'profile1',
          wealthsimple_trade_profile: 'profile2',
        };
        return data[key];
      });

      const deleted = cleanupWealthsimpleLegacyAuth();

      expect(deleted).toBe(6);
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_auth_token');
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_access_token');
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_identity_id');
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_token_expires_at');
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_invest_profile');
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_trade_profile');
    });

    test('should only delete keys that exist', () => {
      GM_getValue.mockImplementation((key) => {
        if (key === 'wealthsimple_auth_token') return 'old-token';
        if (key === 'wealthsimple_identity_id') return 'old-identity';
        return undefined;
      });

      const deleted = cleanupWealthsimpleLegacyAuth();

      expect(deleted).toBe(2);
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_auth_token');
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_identity_id');
      expect(GM_deleteValue).toHaveBeenCalledTimes(2);
    });

    test('should handle errors for individual keys without stopping', () => {
      GM_getValue.mockImplementation((key) => {
        if (key === 'wealthsimple_auth_token') throw new Error('Storage error');
        if (key === 'wealthsimple_identity_id') return 'old-identity';
        return undefined;
      });

      const deleted = cleanupWealthsimpleLegacyAuth();

      expect(deleted).toBe(1);
      expect(GM_deleteValue).toHaveBeenCalledWith('wealthsimple_identity_id');
    });
  });

  describe('migrateAllLegacyStorage', () => {
    test('should return 0 when no legacy data exists', () => {
      GM_getValue.mockReturnValue(undefined);

      const total = migrateAllLegacyStorage();

      expect(total).toBe(0);
    });

    test('should aggregate deletions from all migration steps', () => {
      GM_getValue.mockImplementation((key, defaultVal) => {
        const data = {
          // Rogers Bank auth
          rogersbank_auth_token: 'token',
          rogersbank_account_id: null,
          rogersbank_customer_id: null,
          rogersbank_account_id_encoded: null,
          rogersbank_customer_id_encoded: null,
          rogersbank_device_id: null,
          rogersbank_last_updated: null,
          // Lookback
          wealthsimple_lookback_days: 7,
          // Category mappings
          rogersbank_category_mappings: JSON.stringify({ CAT: 'Dining' }),
          // Wealthsimple legacy auth
          wealthsimple_auth_token: 'old',
        };
        return data[key] !== undefined ? data[key] : defaultVal;
      });

      const total = migrateAllLegacyStorage();

      // 7 (RB auth) + 1 (lookback) + 1 (category) + 1 (WS auth) = 10
      expect(total).toBe(10);
    });

    test('should be idempotent — second run returns 0', () => {
      // First run: has legacy data
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'wealthsimple_lookback_days') return 7;
        return defaultVal;
      });

      const firstRun = migrateAllLegacyStorage();
      expect(firstRun).toBe(1);

      // Second run: legacy key was deleted, GM_getValue returns undefined
      GM_getValue.mockReturnValue(undefined);

      const secondRun = migrateAllLegacyStorage();
      expect(secondRun).toBe(0);
    });

    test('should continue even if one migration step throws', () => {
      // Make Rogers Bank auth throw, but lookback should still work
      let callCount = 0;
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_auth_token') throw new Error('Storage error');
        if (key === 'wealthsimple_lookback_days') return 7;
        return defaultVal;
      });

      const total = migrateAllLegacyStorage();

      // Rogers Bank auth error is caught, but lookback migration succeeds
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });
});