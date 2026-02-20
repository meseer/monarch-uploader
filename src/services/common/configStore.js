/**
 * Integration Config Store
 *
 * Provides a unified interface for per-integration configuration storage.
 * Consolidates scattered individual GM storage keys into a single
 * `{integration}_config` key per integration.
 *
 * Structure of `{integration}_config`:
 * {
 *   auth: { ... },              // Auth tokens/credentials
 *   settings: { ... },          // Lookback days, retention, etc.
 *   categoryMappings: { ... },  // Source category → Monarch category
 *   holdingsMappings: { ... },  // Source security → Monarch holding
 * }
 *
 * @module services/common/configStore
 */

import { debugLog } from '../../core/utils';
import { STORAGE } from '../../core/config';
import { INTEGRATIONS } from '../../core/integrationCapabilities';

// ============================================
// CONFIG STORAGE KEY MAPPING
// ============================================

/**
 * Storage key for each integration's config
 */
const CONFIG_STORAGE_KEYS = {
  [INTEGRATIONS.WEALTHSIMPLE]: STORAGE.WEALTHSIMPLE_CONFIG,
  [INTEGRATIONS.QUESTRADE]: STORAGE.QUESTRADE_CONFIG,
  [INTEGRATIONS.CANADALIFE]: STORAGE.CANADALIFE_CONFIG,
  [INTEGRATIONS.ROGERSBANK]: STORAGE.ROGERSBANK_CONFIG,
};

// ============================================
// CORE CONFIG OPERATIONS
// ============================================

/**
 * Get the storage key for an integration's config
 * @param {string} integrationId - Integration identifier
 * @returns {string|null} Storage key or null if not found
 */
export function getConfigStorageKey(integrationId) {
  return CONFIG_STORAGE_KEYS[integrationId] || null;
}

/**
 * Get the full config object for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {Object} Config object (empty object if not found)
 */
export function getConfig(integrationId) {
  const storageKey = getConfigStorageKey(integrationId);
  if (!storageKey) {
    debugLog(`[configStore.getConfig] Unknown integration: ${integrationId}`);
    return {};
  }

  try {
    const stored = GM_getValue(storageKey, '{}');
    return JSON.parse(stored || '{}');
  } catch (error) {
    debugLog(`[configStore.getConfig] Error parsing config for ${integrationId}:`, error);
    return {};
  }
}

/**
 * Save the full config object for an integration
 * @param {string} integrationId - Integration identifier
 * @param {Object} config - Full config object
 * @returns {boolean} Success status
 */
export function saveConfig(integrationId, config) {
  const storageKey = getConfigStorageKey(integrationId);
  if (!storageKey) {
    debugLog(`[configStore.saveConfig] Unknown integration: ${integrationId}`);
    return false;
  }

  try {
    GM_setValue(storageKey, JSON.stringify(config));
    return true;
  } catch (error) {
    debugLog(`[configStore.saveConfig] Error saving config for ${integrationId}:`, error);
    return false;
  }
}

/**
 * Update a specific section of the config (merge, not replace)
 * @param {string} integrationId - Integration identifier
 * @param {string} section - Section name (e.g., 'auth', 'settings')
 * @param {Object} updates - Properties to merge into the section
 * @returns {boolean} Success status
 */
export function updateConfigSection(integrationId, section, updates) {
  const config = getConfig(integrationId);
  config[section] = {
    ...(config[section] || {}),
    ...updates,
  };
  return saveConfig(integrationId, config);
}

// ============================================
// AUTH OPERATIONS
// ============================================

/**
 * Get auth data for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {Object} Auth data (empty object if not found)
 */
export function getAuth(integrationId) {
  const config = getConfig(integrationId);
  return config.auth || {};
}

/**
 * Save auth data for an integration
 * @param {string} integrationId - Integration identifier
 * @param {Object} authData - Auth data to save
 * @returns {boolean} Success status
 */
export function setAuth(integrationId, authData) {
  return updateConfigSection(integrationId, 'auth', authData);
}

/**
 * Clear auth data for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} Success status
 */
export function clearAuth(integrationId) {
  const config = getConfig(integrationId);
  delete config.auth;
  return saveConfig(integrationId, config);
}

// ============================================
// SETTINGS OPERATIONS
// ============================================

/**
 * Get all settings for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {Object} Settings object (empty object if not found)
 */
export function getSettings(integrationId) {
  const config = getConfig(integrationId);
  return config.settings || {};
}

/**
 * Get a specific setting value
 * @param {string} integrationId - Integration identifier
 * @param {string} key - Setting key
 * @param {*} defaultValue - Default value if not found
 * @returns {*} Setting value
 */
export function getSetting(integrationId, key, defaultValue) {
  const settings = getSettings(integrationId);
  return settings[key] !== undefined ? settings[key] : defaultValue;
}

/**
 * Set a specific setting value
 * @param {string} integrationId - Integration identifier
 * @param {string} key - Setting key
 * @param {*} value - Value to set
 * @returns {boolean} Success status
 */
export function setSetting(integrationId, key, value) {
  return updateConfigSection(integrationId, 'settings', { [key]: value });
}

// ============================================
// CATEGORY MAPPINGS OPERATIONS
// ============================================

/**
 * Get all category mappings for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {Object} Category mappings (empty object if not found)
 */
export function getCategoryMappings(integrationId) {
  const config = getConfig(integrationId);
  return config.categoryMappings || {};
}

/**
 * Save all category mappings for an integration
 * @param {string} integrationId - Integration identifier
 * @param {Object} mappings - Full category mappings object
 * @returns {boolean} Success status
 */
export function saveCategoryMappings(integrationId, mappings) {
  const config = getConfig(integrationId);
  config.categoryMappings = mappings;
  return saveConfig(integrationId, config);
}

/**
 * Get a specific category mapping
 * @param {string} integrationId - Integration identifier
 * @param {string} sourceKey - Source category/merchant key
 * @returns {string|null} Monarch category name or null
 */
export function getCategoryMapping(integrationId, sourceKey) {
  const mappings = getCategoryMappings(integrationId);
  return mappings[sourceKey] || null;
}

/**
 * Set a specific category mapping
 * @param {string} integrationId - Integration identifier
 * @param {string} sourceKey - Source category/merchant key
 * @param {string} monarchCategory - Monarch category name
 * @returns {boolean} Success status
 */
export function setCategoryMapping(integrationId, sourceKey, monarchCategory) {
  const mappings = getCategoryMappings(integrationId);
  mappings[sourceKey] = monarchCategory;
  return saveCategoryMappings(integrationId, mappings);
}

/**
 * Delete a specific category mapping
 * @param {string} integrationId - Integration identifier
 * @param {string} sourceKey - Source category/merchant key
 * @returns {boolean} Success status
 */
export function deleteCategoryMapping(integrationId, sourceKey) {
  const mappings = getCategoryMappings(integrationId);
  delete mappings[sourceKey];
  return saveCategoryMappings(integrationId, mappings);
}

/**
 * Clear all category mappings for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} Success status
 */
export function clearCategoryMappings(integrationId) {
  return saveCategoryMappings(integrationId, {});
}

// ============================================
// HOLDINGS MAPPINGS OPERATIONS
// (Institution-level, shared across accounts)
// ============================================

/**
 * Get all holdings mappings for an integration
 * Holdings mappings are institution-level (not per-account) because
 * the same security maps to the same Monarch holding across accounts.
 * @param {string} integrationId - Integration identifier
 * @returns {Object} Holdings mappings { sourceSecurityKey: { securityId, holdingId, symbol } }
 */
export function getHoldingsMappings(integrationId) {
  const config = getConfig(integrationId);
  return config.holdingsMappings || {};
}

/**
 * Save all holdings mappings for an integration
 * @param {string} integrationId - Integration identifier
 * @param {Object} mappings - Full holdings mappings object
 * @returns {boolean} Success status
 */
export function saveHoldingsMappings(integrationId, mappings) {
  const config = getConfig(integrationId);
  config.holdingsMappings = mappings;
  return saveConfig(integrationId, config);
}

/**
 * Get a specific holding mapping
 * @param {string} integrationId - Integration identifier
 * @param {string} sourceSecurityKey - Source security key/ID
 * @returns {Object|null} Mapping data { securityId, holdingId, symbol } or null
 */
export function getHoldingMapping(integrationId, sourceSecurityKey) {
  const mappings = getHoldingsMappings(integrationId);
  return mappings[sourceSecurityKey] || null;
}

/**
 * Save a specific holding mapping
 * @param {string} integrationId - Integration identifier
 * @param {string} sourceSecurityKey - Source security key/ID
 * @param {Object} mappingData - { securityId, holdingId, symbol }
 * @returns {boolean} Success status
 */
export function saveHoldingMapping(integrationId, sourceSecurityKey, mappingData) {
  const mappings = getHoldingsMappings(integrationId);
  mappings[sourceSecurityKey] = {
    securityId: mappingData.securityId || null,
    holdingId: mappingData.holdingId || null,
    symbol: mappingData.symbol || null,
  };
  return saveHoldingsMappings(integrationId, mappings);
}

/**
 * Delete a specific holding mapping
 * @param {string} integrationId - Integration identifier
 * @param {string} sourceSecurityKey - Source security key/ID
 * @returns {boolean} Success status
 */
export function deleteHoldingMapping(integrationId, sourceSecurityKey) {
  const mappings = getHoldingsMappings(integrationId);
  if (!mappings[sourceSecurityKey]) {
    return false;
  }
  delete mappings[sourceSecurityKey];
  return saveHoldingsMappings(integrationId, mappings);
}

/**
 * Clear all holdings mappings for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} Success status
 */
export function clearHoldingsMappings(integrationId) {
  return saveHoldingsMappings(integrationId, {});
}

// ============================================
// MIGRATION HELPERS
// ============================================

/**
 * Check if an integration has been migrated to configStore
 * (i.e., has a non-empty config object)
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} True if config exists
 */
export function hasConfig(integrationId) {
  const config = getConfig(integrationId);
  return Object.keys(config).length > 0;
}

/**
 * Delete legacy individual storage keys after migration
 * @param {string[]} keys - Array of legacy storage keys to delete
 */
export function deleteLegacyKeys(keys) {
  for (const key of keys) {
    try {
      GM_deleteValue(key);
    } catch (error) {
      debugLog(`[configStore.deleteLegacyKeys] Error deleting key ${key}:`, error);
    }
  }
  debugLog(`[configStore.deleteLegacyKeys] Deleted ${keys.length} legacy keys`);
}

export default {
  // Core
  getConfigStorageKey,
  getConfig,
  saveConfig,
  updateConfigSection,

  // Auth
  getAuth,
  setAuth,
  clearAuth,

  // Settings
  getSettings,
  getSetting,
  setSetting,

  // Category mappings
  getCategoryMappings,
  saveCategoryMappings,
  getCategoryMapping,
  setCategoryMapping,
  deleteCategoryMapping,
  clearCategoryMappings,

  // Holdings mappings (institution-level)
  getHoldingsMappings,
  saveHoldingsMappings,
  getHoldingMapping,
  saveHoldingMapping,
  deleteHoldingMapping,
  clearHoldingsMappings,

  // Migration
  hasConfig,
  deleteLegacyKeys,
};