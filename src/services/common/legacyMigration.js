/**
 * Legacy Storage Migration
 *
 * Eagerly migrates all legacy individual GM storage keys into the consolidated
 * `{integration}_config` configStore structure. This runs once at script load
 * to ensure legacy data is migrated promptly, not just lazily on first read.
 *
 * Each migration is idempotent: it only copies data if the configStore section
 * is empty, and always deletes the legacy key afterward.
 *
 * @module services/common/legacyMigration
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import {
  getAuth,
  setAuth,
  getSetting,
  setSetting,
  getCategoryMappings,
  saveCategoryMappings,
} from './configStore';

/**
 * Legacy Wealthsimple auth storage keys (orphaned after previous migration)
 */
const WEALTHSIMPLE_LEGACY_AUTH_KEYS = [
  STORAGE.WEALTHSIMPLE_AUTH_TOKEN,
  STORAGE.WEALTHSIMPLE_ACCESS_TOKEN,
  STORAGE.WEALTHSIMPLE_IDENTITY_ID,
  STORAGE.WEALTHSIMPLE_TOKEN_EXPIRES_AT,
  STORAGE.WEALTHSIMPLE_INVEST_PROFILE,
  STORAGE.WEALTHSIMPLE_TRADE_PROFILE,
];

/**
 * Legacy Rogers Bank auth storage keys
 */
const ROGERSBANK_LEGACY_AUTH_KEYS = [
  STORAGE.ROGERSBANK_AUTH_TOKEN,
  STORAGE.ROGERSBANK_ACCOUNT_ID,
  STORAGE.ROGERSBANK_CUSTOMER_ID,
  STORAGE.ROGERSBANK_ACCOUNT_ID_ENCODED,
  STORAGE.ROGERSBANK_CUSTOMER_ID_ENCODED,
  STORAGE.ROGERSBANK_DEVICE_ID,
  STORAGE.ROGERSBANK_LAST_UPDATED,
];

/**
 * Lookback days legacy key mapping
 */
const LOOKBACK_LEGACY_KEYS = [
  { id: INTEGRATIONS.WEALTHSIMPLE, legacyKey: STORAGE.WEALTHSIMPLE_LOOKBACK_DAYS },
  { id: INTEGRATIONS.ROGERSBANK, legacyKey: STORAGE.ROGERSBANK_LOOKBACK_DAYS },
  { id: INTEGRATIONS.QUESTRADE, legacyKey: STORAGE.QUESTRADE_LOOKBACK_DAYS },
  { id: INTEGRATIONS.CANADALIFE, legacyKey: STORAGE.CANADALIFE_LOOKBACK_DAYS },
];

/**
 * Category mappings legacy key mapping
 */
const CATEGORY_MAPPINGS_LEGACY_KEYS = [
  { id: INTEGRATIONS.ROGERSBANK, legacyKey: STORAGE.ROGERSBANK_CATEGORY_MAPPINGS },
  { id: INTEGRATIONS.WEALTHSIMPLE, legacyKey: STORAGE.WEALTHSIMPLE_CATEGORY_MAPPINGS },
];

/**
 * Safely delete a legacy GM storage key
 * @param {string} key - Storage key to delete
 */
function safeDelete(key) {
  try {
    GM_deleteValue(key);
  } catch (error) {
    debugLog(`[legacyMigration] Error deleting key ${key}:`, error);
  }
}

/**
 * Migrate Rogers Bank auth from legacy individual keys to configStore
 * @returns {number} Number of legacy keys deleted
 */
export function migrateRogersBankAuth() {
  let deleted = 0;

  try {
    const legacyToken = GM_getValue(STORAGE.ROGERSBANK_AUTH_TOKEN, null);
    if (!legacyToken) {
      return 0; // No legacy data
    }

    // Only migrate if configStore auth is empty
    const configAuth = getAuth(INTEGRATIONS.ROGERSBANK);
    if (!configAuth.authToken && !configAuth.accountId) {
      const legacyData = {
        authToken: legacyToken,
        accountId: GM_getValue(STORAGE.ROGERSBANK_ACCOUNT_ID, null),
        customerId: GM_getValue(STORAGE.ROGERSBANK_CUSTOMER_ID, null),
        accountIdEncoded: GM_getValue(STORAGE.ROGERSBANK_ACCOUNT_ID_ENCODED, null),
        customerIdEncoded: GM_getValue(STORAGE.ROGERSBANK_CUSTOMER_ID_ENCODED, null),
        deviceId: GM_getValue(STORAGE.ROGERSBANK_DEVICE_ID, null),
        lastUpdated: GM_getValue(STORAGE.ROGERSBANK_LAST_UPDATED, null),
      };
      setAuth(INTEGRATIONS.ROGERSBANK, legacyData);
      debugLog('[legacyMigration] Migrated Rogers Bank auth to configStore');
    }

    // Always delete legacy keys
    for (const key of ROGERSBANK_LEGACY_AUTH_KEYS) {
      safeDelete(key);
      deleted++;
    }
    debugLog(`[legacyMigration] Deleted ${deleted} Rogers Bank legacy auth keys`);
  } catch (error) {
    debugLog('[legacyMigration] Error migrating Rogers Bank auth:', error);
  }

  return deleted;
}

/**
 * Migrate lookback days from legacy individual keys to configStore
 * @returns {number} Number of legacy keys deleted
 */
export function migrateLookbackDays() {
  let deleted = 0;

  for (const { id, legacyKey } of LOOKBACK_LEGACY_KEYS) {
    try {
      const legacyValue = GM_getValue(legacyKey, undefined);
      if (legacyValue === undefined) {
        continue; // No legacy data for this integration
      }

      // Only migrate if configStore doesn't have a value
      const configValue = getSetting(id, 'lookbackDays', undefined);
      if (configValue === undefined) {
        setSetting(id, 'lookbackDays', legacyValue);
        debugLog(`[legacyMigration] Migrated lookback days for ${id}: ${legacyValue}`);
      }

      // Always delete legacy key
      safeDelete(legacyKey);
      deleted++;
      debugLog(`[legacyMigration] Deleted legacy lookback key: ${legacyKey}`);
    } catch (error) {
      debugLog(`[legacyMigration] Error migrating lookback for ${id}:`, error);
    }
  }

  return deleted;
}

/**
 * Migrate category mappings from legacy individual keys to configStore
 * @returns {number} Number of legacy keys deleted
 */
export function migrateCategoryMappings() {
  let deleted = 0;

  for (const { id, legacyKey } of CATEGORY_MAPPINGS_LEGACY_KEYS) {
    try {
      const legacyRaw = GM_getValue(legacyKey, undefined);
      if (legacyRaw === undefined) {
        continue; // No legacy data for this integration
      }

      // Parse the legacy data
      let legacyMappings;
      try {
        legacyMappings = JSON.parse(legacyRaw);
      } catch {
        debugLog(`[legacyMigration] Invalid JSON in legacy key ${legacyKey}, deleting`);
        safeDelete(legacyKey);
        deleted++;
        continue;
      }

      // Only migrate if configStore is empty and legacy has data
      if (Object.keys(legacyMappings).length > 0) {
        const configMappings = getCategoryMappings(id);
        if (Object.keys(configMappings).length === 0) {
          saveCategoryMappings(id, legacyMappings);
          debugLog(`[legacyMigration] Migrated ${Object.keys(legacyMappings).length} category mappings for ${id}`);
        }
      }

      // Always delete legacy key
      safeDelete(legacyKey);
      deleted++;
      debugLog(`[legacyMigration] Deleted legacy category mappings key: ${legacyKey}`);
    } catch (error) {
      debugLog(`[legacyMigration] Error migrating category mappings for ${id}:`, error);
    }
  }

  return deleted;
}

/**
 * Clean up orphaned Wealthsimple legacy auth keys
 * These keys were already migrated in a previous version but may still exist in storage
 * @returns {number} Number of legacy keys deleted
 */
export function cleanupWealthsimpleLegacyAuth() {
  let deleted = 0;

  for (const key of WEALTHSIMPLE_LEGACY_AUTH_KEYS) {
    try {
      const value = GM_getValue(key, undefined);
      if (value !== undefined) {
        safeDelete(key);
        deleted++;
      }
    } catch (error) {
      debugLog(`[legacyMigration] Error cleaning up Wealthsimple key ${key}:`, error);
    }
  }

  if (deleted > 0) {
    debugLog(`[legacyMigration] Cleaned up ${deleted} orphaned Wealthsimple legacy auth keys`);
  }

  return deleted;
}

/**
 * Run all legacy storage migrations eagerly at script load.
 * Each migration is idempotent and safe to run multiple times.
 * @returns {number} Total number of legacy keys deleted
 */
export function migrateAllLegacyStorage() {
  debugLog('[legacyMigration] Starting eager legacy storage migration...');

  let totalDeleted = 0;

  totalDeleted += migrateRogersBankAuth();
  totalDeleted += migrateLookbackDays();
  totalDeleted += migrateCategoryMappings();
  totalDeleted += cleanupWealthsimpleLegacyAuth();

  if (totalDeleted > 0) {
    debugLog(`[legacyMigration] Eager migration complete: deleted ${totalDeleted} legacy key(s)`);
  } else {
    debugLog('[legacyMigration] No legacy keys found to migrate');
  }

  return totalDeleted;
}

export default {
  migrateAllLegacyStorage,
  migrateRogersBankAuth,
  migrateLookbackDays,
  migrateCategoryMappings,
  cleanupWealthsimpleLegacyAuth,
};