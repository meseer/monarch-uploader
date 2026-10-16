/**
 * Legacy Storage Migration
 *
 * Eagerly migrates Rogers Bank legacy individual GM storage keys into the
 * consolidated `rogersbank_config` configStore structure, and deletes Rogers
 * Bank credentials stored by earlier versions. This runs at every script load
 * so legacy data is handled promptly, not just lazily on first read.
 *
 * Each step is idempotent: once nothing legacy is left, it writes nothing.
 *
 * Note: Questrade, Canada Life, and Wealthsimple migration has been completed
 * and removed. Only Rogers Bank migration remains.
 *
 * @module services/common/legacyMigration
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import {
  getConfig,
  clearAuth,
  getSetting,
  setSetting,
  getCategoryMappings,
  saveCategoryMappings,
} from './configStore';

/**
 * Legacy Rogers Bank credential keys. Rogers Bank credentials are no longer
 * persisted, so these are deleted, never migrated.
 */
const ROGERSBANK_LEGACY_CREDENTIAL_KEYS = [
  STORAGE.ROGERSBANK_AUTH_TOKEN,
  STORAGE.ROGERSBANK_ACCOUNT_ID,
  STORAGE.ROGERSBANK_CUSTOMER_ID,
  STORAGE.ROGERSBANK_ACCOUNT_ID_ENCODED,
  STORAGE.ROGERSBANK_CUSTOMER_ID_ENCODED,
  STORAGE.ROGERSBANK_DEVICE_ID,
  STORAGE.ROGERSBANK_LAST_UPDATED,
];

/**
 * Lookback days legacy key mapping (Rogers Bank only)
 */
const LOOKBACK_LEGACY_KEYS = [
  { id: INTEGRATIONS.ROGERSBANK, legacyKey: STORAGE.ROGERSBANK_LOOKBACK_DAYS },
];

/**
 * Category mappings legacy key mapping (Rogers Bank only)
 */
const CATEGORY_MAPPINGS_LEGACY_KEYS = [
  { id: INTEGRATIONS.ROGERSBANK, legacyKey: STORAGE.ROGERSBANK_CATEGORY_MAPPINGS },
];

/**
 * Safely delete a legacy GM storage key
 * @param {string} key - Storage key to delete
 */
function safeDelete(key: string): void {
  try {
    GM_deleteValue(key);
  } catch (error) {
    debugLog(`[legacyMigration] Error deleting key ${key}:`, error);
  }
}

/**
 * Delete Rogers Bank credentials stored by earlier versions.
 *
 * Rogers Bank credentials are now held in memory for the current page only
 * (see `src/api/rogersbank.ts`). Earlier versions persisted them, first under
 * the individual legacy keys and later in the `auth` section of
 * `rogersbank_config`. This deletes both. Rogers Bank settings, category
 * mappings and `rogersbank_accounts_list` are left untouched.
 *
 * Idempotent: once no stored credentials remain, it writes nothing.
 * @returns {number} Number of stored credential items deleted (legacy keys plus the `auth` section)
 */
export function purgeStoredRogersBankCredentials(): number {
  let deleted = 0;

  for (const key of ROGERSBANK_LEGACY_CREDENTIAL_KEYS) {
    try {
      if (GM_getValue(key, undefined) !== undefined) {
        safeDelete(key);
        deleted++;
      }
    } catch (error) {
      debugLog(`[legacyMigration] Error checking legacy Rogers Bank key ${key}:`, error);
    }
  }

  try {
    const config = getConfig(INTEGRATIONS.ROGERSBANK);
    if (Object.prototype.hasOwnProperty.call(config, 'auth') && clearAuth(INTEGRATIONS.ROGERSBANK)) {
      deleted++;
    }
  } catch (error) {
    debugLog('[legacyMigration] Error deleting stored Rogers Bank auth:', error);
  }

  if (deleted > 0) {
    debugLog(`[legacyMigration] Deleted ${deleted} stored Rogers Bank credential item(s)`);
  }

  return deleted;
}

/**
 * Migrate lookback days from legacy individual keys to configStore
 * @returns {number} Number of legacy keys deleted
 */
export function migrateLookbackDays(): number {
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
export function migrateCategoryMappings(): number {
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
 * Run all legacy storage migrations eagerly at script load.
 * Each migration is idempotent and safe to run multiple times.
 * @returns {number} Total number of legacy keys deleted
 */
export function migrateAllLegacyStorage(): number {
  debugLog('[legacyMigration] Starting eager legacy storage migration...');

  let totalDeleted = 0;

  totalDeleted += purgeStoredRogersBankCredentials();
  totalDeleted += migrateLookbackDays();
  totalDeleted += migrateCategoryMappings();

  if (totalDeleted > 0) {
    debugLog(`[legacyMigration] Eager migration complete: deleted ${totalDeleted} legacy key(s)`);
  } else {
    debugLog('[legacyMigration] No legacy keys found to migrate');
  }

  return totalDeleted;
}

