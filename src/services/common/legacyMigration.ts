/**
 * Legacy Storage Migration
 *
 * Eagerly migrates Rogers Bank legacy individual GM storage keys into the
 * consolidated `rogersbank_config` configStore structure, and deletes Rogers
 * Bank and Wealthsimple credentials stored by earlier versions (ADR-010). This
 * runs at every script load so legacy data is handled promptly, not just lazily
 * on first read.
 *
 * Each step is idempotent: once nothing legacy is left, it writes nothing.
 *
 * Note: Questrade, Canada Life, and Wealthsimple migration has been completed
 * and removed. Only Rogers Bank migration and the credential purges remain.
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
 * Individual Wealthsimple auth keys written by versions before 5.85.0. The
 * startup step that deleted them shipped only from 5.84.6 until 5.85.0, so a
 * user who upgraded past that window may still have them. They were dropped
 * from `STORAGE` in 5.85.0, so the literal keys are listed here.
 */
const WEALTHSIMPLE_LEGACY_AUTH_KEYS = [
  'wealthsimple_auth_token',
  'wealthsimple_access_token',
  'wealthsimple_identity_id',
  'wealthsimple_token_expires_at',
  'wealthsimple_invest_profile',
  'wealthsimple_trade_profile',
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
 * Delete each of the given legacy keys that is present
 * @param keys - Legacy GM storage keys
 * @param label - Integration name for log messages
 * @returns Number of keys deleted
 */
function deleteLegacyKeysIfPresent(keys: readonly string[], label: string): number {
  let deleted = 0;

  for (const key of keys) {
    try {
      if (GM_getValue(key, undefined) !== undefined) {
        safeDelete(key);
        deleted++;
      }
    } catch (error) {
      debugLog(`[legacyMigration] Error checking legacy ${label} key ${key}:`, error);
    }
  }

  return deleted;
}

/**
 * Delete the `auth` section of an integration's config. Writes nothing when
 * there is no such section, so it never creates a config.
 * @param integrationId - Integration identifier
 * @param label - Integration name for log messages
 * @returns True if a stored `auth` section was deleted
 */
function deleteStoredAuthSection(integrationId: string, label: string): boolean {
  try {
    const config = getConfig(integrationId);
    return Object.prototype.hasOwnProperty.call(config, 'auth') && clearAuth(integrationId);
  } catch (error) {
    debugLog(`[legacyMigration] Error deleting stored ${label} auth:`, error);
    return false;
  }
}

/**
 * Delete Wealthsimple auth stored by earlier versions.
 *
 * The Wealthsimple token is now read from the page's OAuth cookie whenever it
 * is needed (see `checkAuth` in `src/api/wealthsimple.ts`). Earlier versions
 * copied it, with the identity ID, expiry and profile IDs, into the `auth`
 * section of `wealthsimple_config`, and before that into individual keys. This
 * deletes both. Wealthsimple settings, category and holdings mappings and
 * `wealthsimple_accounts_list` are left untouched.
 *
 * Idempotent: once no stored auth remains, it writes nothing. It never creates
 * `wealthsimple_config` for users who don't have one.
 * @returns {number} Number of stored auth items deleted (legacy keys plus the `auth` section)
 */
export function purgeStoredWealthsimpleAuth(): number {
  let deleted = deleteLegacyKeysIfPresent(WEALTHSIMPLE_LEGACY_AUTH_KEYS, 'Wealthsimple');

  if (deleteStoredAuthSection(INTEGRATIONS.WEALTHSIMPLE, 'Wealthsimple')) {
    deleted++;
  }

  if (deleted > 0) {
    debugLog(`[legacyMigration] Deleted ${deleted} stored Wealthsimple auth item(s)`);
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
  totalDeleted += purgeStoredWealthsimpleAuth();
  totalDeleted += migrateLookbackDays();
  totalDeleted += migrateCategoryMappings();

  if (totalDeleted > 0) {
    debugLog(`[legacyMigration] Eager migration complete: deleted ${totalDeleted} legacy key(s)`);
  } else {
    debugLog('[legacyMigration] No legacy keys found to migrate');
  }

  return totalDeleted;
}

