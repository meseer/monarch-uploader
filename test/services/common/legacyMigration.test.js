/**
 * Tests for Legacy Storage Migration (Rogers Bank only)
 *
 * Questrade, Canada Life, and Wealthsimple migration has been completed
 * and removed. Only Rogers Bank migration remains.
 *
 * The purge of stored Rogers Bank credentials is covered against the real
 * configStore in legacyMigration.rogersCredentials.test.js.
 */

import {
  migrateAllLegacyStorage,
  migrateLookbackDays,
  migrateCategoryMappings,
} from '../../../src/services/common/legacyMigration';

// Mock dependencies
vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
}));

vi.mock('../../../src/core/config', () => ({
  STORAGE: {
    // Rogers Bank auth
    ROGERSBANK_AUTH_TOKEN: 'rogersbank_auth_token',
    ROGERSBANK_ACCOUNT_ID: 'rogersbank_account_id',
    ROGERSBANK_CUSTOMER_ID: 'rogersbank_customer_id',
    ROGERSBANK_ACCOUNT_ID_ENCODED: 'rogersbank_account_id_encoded',
    ROGERSBANK_CUSTOMER_ID_ENCODED: 'rogersbank_customer_id_encoded',
    ROGERSBANK_DEVICE_ID: 'rogersbank_device_id',
    ROGERSBANK_LAST_UPDATED: 'rogersbank_last_updated',
    // Lookback days (Rogers Bank only)
    ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
    // Category mappings (Rogers Bank only)
    ROGERSBANK_CATEGORY_MAPPINGS: 'rogersbank_category_mappings',
    // Config store keys
    ROGERSBANK_CONFIG: 'rogersbank_config',
  },
  TRANSACTION_RETENTION_DEFAULTS: { DAYS: 91, COUNT: 1000 },
}));

vi.mock('../../../src/core/integrationCapabilities', () => ({
  INTEGRATIONS: {
    WEALTHSIMPLE: 'wealthsimple',
    QUESTRADE: 'questrade',
    CANADALIFE: 'canadalife',
    ROGERSBANK: 'rogersbank',
  },
}));

// Mock configStore — track calls via simple in-memory store
const mockConfigData = {};

vi.mock('../../../src/services/common/configStore', () => ({
  getConfig: vi.fn((id) => mockConfigData[`${id}_config`] || {}),
  clearAuth: vi.fn((id) => {
    if (mockConfigData[`${id}_config`]) delete mockConfigData[`${id}_config`].auth;
    return true;
  }),
  getSetting: vi.fn((id, key, defaultVal) => {
    const config = mockConfigData[`${id}_config`];
    return config?.settings?.[key] !== undefined ? config.settings[key] : defaultVal;
  }),
  setSetting: vi.fn((id, key, value) => {
    if (!mockConfigData[`${id}_config`]) mockConfigData[`${id}_config`] = {};
    if (!mockConfigData[`${id}_config`].settings) mockConfigData[`${id}_config`].settings = {};
    mockConfigData[`${id}_config`].settings[key] = value;
  }),
  getCategoryMappings: vi.fn((id) => {
    const config = mockConfigData[`${id}_config`];
    return config?.categoryMappings || {};
  }),
  saveCategoryMappings: vi.fn((id, mappings) => {
    if (!mockConfigData[`${id}_config`]) mockConfigData[`${id}_config`] = {};
    mockConfigData[`${id}_config`].categoryMappings = mappings;
  }),
}));

// Mock GM functions
globalThis.GM_getValue = vi.fn();
globalThis.GM_setValue = vi.fn();
globalThis.GM_deleteValue = vi.fn();

// Import mocks for assertions
import * as configStore from '../../../src/services/common/configStore';

describe('Legacy Storage Migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear mock config data
    Object.keys(mockConfigData).forEach((key) => delete mockConfigData[key]);
    // Default: no legacy data
    globalThis.GM_getValue.mockReturnValue(undefined);
  });

  describe('migrateLookbackDays', () => {
    test('should skip when no legacy lookback keys exist', () => {
      GM_getValue.mockReturnValue(undefined);

      const deleted = migrateLookbackDays();

      expect(deleted).toBe(0);
      expect(configStore.setSetting).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
    });

    test('should migrate Rogers Bank legacy lookback key', () => {
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_lookback_days') return 14;
        return defaultVal;
      });

      const deleted = migrateLookbackDays();

      expect(deleted).toBe(1);
      expect(configStore.setSetting).toHaveBeenCalledWith('rogersbank', 'lookbackDays', 14);
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_lookback_days');
    });

    test('should not overwrite configStore when it already has a value', () => {
      mockConfigData.rogersbank_config = {
        settings: { lookbackDays: 30 },
      };

      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_lookback_days') return 7;
        return defaultVal;
      });

      const deleted = migrateLookbackDays();

      expect(deleted).toBe(1); // Still deletes legacy key
      expect(configStore.setSetting).not.toHaveBeenCalled(); // Does not overwrite
      expect(GM_deleteValue).toHaveBeenCalledWith('rogersbank_lookback_days');
    });

    test('should handle errors gracefully', () => {
      GM_getValue.mockImplementation(() => {
        throw new Error('Storage error');
      });

      expect(() => migrateLookbackDays()).not.toThrow();
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
          rogersbank_lookback_days: 14,
          // Category mappings
          rogersbank_category_mappings: JSON.stringify({ CAT: 'Dining' }),
        };
        return data[key] !== undefined ? data[key] : defaultVal;
      });

      const total = migrateAllLegacyStorage();

      // 7 (RB legacy credential keys) + 1 (lookback) + 1 (category) = 9
      expect(total).toBe(9);
      // Credentials are deleted, never copied into the config
      expect(mockConfigData.rogersbank_config?.auth).toBeUndefined();
    });

    test('should delete Rogers Bank auth stored in the config without touching settings', () => {
      mockConfigData.rogersbank_config = {
        auth: { authToken: 'stored-token' },
        settings: { lookbackDays: 7 },
      };

      const total = migrateAllLegacyStorage();

      expect(total).toBe(1);
      expect(configStore.clearAuth).toHaveBeenCalledWith('rogersbank');
      expect(mockConfigData.rogersbank_config).toEqual({ settings: { lookbackDays: 7 } });
    });

    test('should be idempotent — second run returns 0', () => {
      // First run: has legacy data
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_lookback_days') return 14;
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
      // Make the Rogers Bank credential purge throw, but lookback should still work
      GM_getValue.mockImplementation((key, defaultVal) => {
        if (key === 'rogersbank_auth_token') throw new Error('Storage error');
        if (key === 'rogersbank_lookback_days') return 14;
        return defaultVal;
      });

      const total = migrateAllLegacyStorage();

      // Rogers Bank purge error is caught, but lookback migration succeeds
      expect(total).toBeGreaterThanOrEqual(1);
    });
  });
});