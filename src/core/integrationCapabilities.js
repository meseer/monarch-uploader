/**
 * Integration Capabilities Configuration
 *
 * Defines what each integration supports in terms of features and settings.
 * Used by the settings UI to dynamically render appropriate options.
 */

import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from './config';

/**
 * Integration identifiers
 */
export const INTEGRATIONS = {
  WEALTHSIMPLE: 'wealthsimple',
  QUESTRADE: 'questrade',
  CANADALIFE: 'canadalife',
  ROGERSBANK: 'rogersbank',
  MBNA: 'mbna',
};

/**
 * Favicon domains for each integration
 * Used to fetch logos via Google Favicon API
 */
export const FAVICON_DOMAINS = {
  [INTEGRATIONS.WEALTHSIMPLE]: 'wealthsimple.com',
  [INTEGRATIONS.QUESTRADE]: 'questrade.com',
  [INTEGRATIONS.CANADALIFE]: 'canadalife.com',
  [INTEGRATIONS.ROGERSBANK]: 'rogersbank.com',
};

/**
 * Available settings keys for per-account configuration
 */
export const ACCOUNT_SETTINGS = {
  STORE_TX_DETAILS_IN_NOTES: 'storeTransactionDetailsInNotes',
  TRANSACTION_RETENTION_DAYS: 'transactionRetentionDays',
  TRANSACTION_RETENTION_COUNT: 'transactionRetentionCount',
  STRIP_STORE_NUMBERS: 'stripStoreNumbers',
  INCLUDE_PENDING_TRANSACTIONS: 'includePendingTransactions',
  INVERT_BALANCE: 'invertBalance',
  SKIP_CATEGORIZATION: 'skipCategorization',
};

/**
 * Capabilities configuration for each integration
 *
 * @typedef {Object} IntegrationCapabilities
 * @property {string} id - Integration identifier
 * @property {string} displayName - Human-readable name
 * @property {string} accountKeyName - Key name for the source account in consolidated structure
 * @property {boolean} hasTransactions - Whether the integration supports transaction upload
 * @property {boolean} hasDeduplication - Whether the integration needs transaction deduplication
 * @property {boolean} hasBalanceHistory - Whether the integration supports balance history
 * @property {boolean} hasCreditLimit - Whether the integration supports credit limit sync
 * @property {boolean} hasHoldings - Whether the integration supports holdings/positions
 * @property {boolean} hasBalanceReconstruction - Whether balance can be reconstructed from transactions
 * @property {boolean} hasCategorization - Whether the integration supports category mappings
 * @property {string|null} categoryMappingsStorageKey - Storage key for category mappings (null if no categorization)
 * @property {string|null} categorySourceLabel - Label for the source column in category UI (null if no categorization)
 * @property {string[]} settings - List of available per-account settings
 * @property {Object} settingDefaults - Default values for per-account settings
 */

/**
 * Integration capabilities definitions
 */
export const INTEGRATION_CAPABILITIES = {
  [INTEGRATIONS.WEALTHSIMPLE]: {
    id: INTEGRATIONS.WEALTHSIMPLE,
    displayName: 'Wealthsimple',
    accountKeyName: 'wealthsimpleAccount',
    configStorageKey: STORAGE.WEALTHSIMPLE_CONFIG,
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: true, // For credit card accounts
    hasHoldings: true,
    hasBalanceReconstruction: true, // For credit cards
    hasCategorization: true, // Merchant name to Monarch category mappings
    categoryMappingsStorageKey: STORAGE.WEALTHSIMPLE_CONFIG,
    categorySourceLabel: 'Merchant Name',
    settings: [
      ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES,
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT,
      ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS,
      ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS,
      ACCOUNT_SETTINGS.SKIP_CATEGORIZATION,
    ],
    settingDefaults: {
      [ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES]: false,
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS]: TRANSACTION_RETENTION_DEFAULTS.DAYS,
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT]: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      [ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS]: true,
      [ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS]: true,
      [ACCOUNT_SETTINGS.SKIP_CATEGORIZATION]: false,
    },
  },

  [INTEGRATIONS.QUESTRADE]: {
    id: INTEGRATIONS.QUESTRADE,
    displayName: 'Questrade',
    accountKeyName: 'questradeAccount',
    configStorageKey: STORAGE.QUESTRADE_CONFIG,
    hasTransactions: true, // Order transactions
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: false,
    hasHoldings: true,
    hasBalanceReconstruction: false,
    hasCategorization: false,
    categoryMappingsStorageKey: null,
    categorySourceLabel: null,
    settings: [
      ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES,
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT,
      ACCOUNT_SETTINGS.SKIP_CATEGORIZATION,
    ],
    settingDefaults: {
      [ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES]: false,
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS]: TRANSACTION_RETENTION_DEFAULTS.DAYS,
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT]: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      [ACCOUNT_SETTINGS.SKIP_CATEGORIZATION]: false,
    },
  },

  [INTEGRATIONS.CANADALIFE]: {
    id: INTEGRATIONS.CANADALIFE,
    displayName: 'Canada Life',
    accountKeyName: 'canadalifeAccount',
    configStorageKey: STORAGE.CANADALIFE_CONFIG,
    hasTransactions: true, // Supports activity/transaction upload
    hasDeduplication: true, // Uses hash-based transaction IDs for deduplication
    hasBalanceHistory: true,
    hasCreditLimit: false,
    hasHoldings: false, // Private mutual funds - no positions API
    hasBalanceReconstruction: false,
    hasCategorization: false, // Activity types map directly to Buy/Sell categories
    categoryMappingsStorageKey: null,
    categorySourceLabel: null,
    settings: [
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT,
    ],
    settingDefaults: {
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS]: TRANSACTION_RETENTION_DEFAULTS.DAYS,
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT]: TRANSACTION_RETENTION_DEFAULTS.COUNT,
    },
  },

  [INTEGRATIONS.ROGERSBANK]: {
    id: INTEGRATIONS.ROGERSBANK,
    displayName: 'Rogers Bank',
    accountKeyName: 'rogersbankAccount',
    configStorageKey: STORAGE.ROGERSBANK_CONFIG,
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: true,
    hasHoldings: false, // Credit card only
    hasBalanceReconstruction: true,
    hasCategorization: true, // Bank category to Monarch category mappings
    categoryMappingsStorageKey: STORAGE.ROGERSBANK_CONFIG,
    categorySourceLabel: 'Bank Category',
    settings: [
      ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES,
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
      ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT,
      ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS,
      ACCOUNT_SETTINGS.INVERT_BALANCE,
      ACCOUNT_SETTINGS.SKIP_CATEGORIZATION,
    ],
    settingDefaults: {
      [ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES]: false,
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS]: TRANSACTION_RETENTION_DEFAULTS.DAYS,
      [ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT]: TRANSACTION_RETENTION_DEFAULTS.COUNT,
      [ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS]: true,
      [ACCOUNT_SETTINGS.INVERT_BALANCE]: false,
      [ACCOUNT_SETTINGS.SKIP_CATEGORIZATION]: false,
    },
  },
};

/**
 * Build a legacy-compatible capabilities object from a modular integration manifest.
 * This bridges the gap between the new registry-based manifests and legacy code
 * that expects INTEGRATION_CAPABILITIES entries.
 *
 * @param {Object} manifest - Integration manifest from the registry
 * @returns {IntegrationCapabilities} Capabilities object compatible with legacy consumers
 */
function buildCapabilitiesFromManifest(manifest) {
  const settingKeys = (manifest.settings || []).map((s) => s.key);
  const settingDefaults = {};
  (manifest.settings || []).forEach((s) => {
    settingDefaults[s.key] = s.default;
  });

  return {
    id: manifest.id,
    displayName: manifest.displayName,
    accountKeyName: manifest.accountKeyName,
    configStorageKey: manifest.storageKeys?.config || null,
    hasTransactions: manifest.capabilities?.hasTransactions || false,
    hasDeduplication: manifest.capabilities?.hasDeduplication || false,
    hasBalanceHistory: manifest.capabilities?.hasBalanceHistory || false,
    hasCreditLimit: manifest.capabilities?.hasCreditLimit || false,
    hasHoldings: manifest.capabilities?.hasHoldings || false,
    hasBalanceReconstruction: manifest.capabilities?.hasBalanceReconstruction || false,
    hasCategorization: manifest.capabilities?.hasCategorization || false,
    categoryMappingsStorageKey: manifest.capabilities?.hasCategorization
      ? (manifest.storageKeys?.config || null) : null,
    categorySourceLabel: manifest.categoryConfig?.sourceLabel || null,
    settings: settingKeys,
    settingDefaults,
  };
}

/**
 * Get capabilities for a specific integration.
 * Checks the hardcoded INTEGRATION_CAPABILITIES first, then falls back to
 * building capabilities from the modular integration registry manifest.
 *
 * @param {string} integrationId - Integration identifier
 * @returns {IntegrationCapabilities|null} Capabilities object or null if not found
 */
export function getCapabilities(integrationId) {
  // Check hardcoded legacy capabilities first
  if (INTEGRATION_CAPABILITIES[integrationId]) {
    return INTEGRATION_CAPABILITIES[integrationId];
  }

  // Fall back to modular integration registry manifest (lazy require to avoid circular dependency)
  // Chain: integrationCapabilities ’ integrationRegistry ’ utils ’ configStore ’ integrationCapabilities
  const { getManifest } = require('./integrationRegistry');
  const manifest = getManifest(integrationId);
  if (manifest) {
    return buildCapabilitiesFromManifest(manifest);
  }

  return null;
}

/**
 * Check if an integration supports a specific capability
 * @param {string} integrationId - Integration identifier
 * @param {string} capability - Capability name (e.g., 'hasTransactions', 'hasDeduplication')
 * @returns {boolean} True if the integration has the capability
 */
export function hasCapability(integrationId, capability) {
  const capabilities = getCapabilities(integrationId);
  return capabilities ? Boolean(capabilities[capability]) : false;
}

/**
 * Check if an integration supports a specific setting
 * @param {string} integrationId - Integration identifier
 * @param {string} settingKey - Setting key from ACCOUNT_SETTINGS
 * @returns {boolean} True if the integration supports the setting
 */
export function hasSetting(integrationId, settingKey) {
  const capabilities = getCapabilities(integrationId);
  return capabilities ? capabilities.settings.includes(settingKey) : false;
}

/**
 * Get default value for a specific setting
 * @param {string} integrationId - Integration identifier
 * @param {string} settingKey - Setting key from ACCOUNT_SETTINGS
 * @returns {*} Default value for the setting, or undefined if not found
 */
export function getSettingDefault(integrationId, settingKey) {
  const capabilities = getCapabilities(integrationId);
  if (!capabilities || !capabilities.settingDefaults) {
    return undefined;
  }
  return capabilities.settingDefaults[settingKey];
}

/**
 * Get all settings with their defaults for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {Object} Object with setting keys and default values
 */
export function getDefaultSettings(integrationId) {
  const capabilities = getCapabilities(integrationId);
  return capabilities?.settingDefaults || {};
}

/**
 * Get the account key name for an integration
 * Used to access the source account data in consolidated structure
 * @param {string} integrationId - Integration identifier
 * @returns {string|null} Account key name (e.g., 'wealthsimpleAccount')
 */
export function getAccountKeyName(integrationId) {
  const capabilities = getCapabilities(integrationId);
  return capabilities?.accountKeyName || null;
}

/**
 * Get all integrations that support a specific capability
 * @param {string} capability - Capability name
 * @returns {string[]} Array of integration IDs that have the capability
 */
export function getIntegrationsWithCapability(capability) {
  return Object.keys(INTEGRATION_CAPABILITIES).filter(
    (id) => INTEGRATION_CAPABILITIES[id][capability],
  );
}

/**
 * Get all integrations that support a specific setting
 * @param {string} settingKey - Setting key from ACCOUNT_SETTINGS
 * @returns {string[]} Array of integration IDs that support the setting
 */
export function getIntegrationsWithSetting(settingKey) {
  return Object.keys(INTEGRATION_CAPABILITIES).filter(
    (id) => INTEGRATION_CAPABILITIES[id].settings.includes(settingKey),
  );
}

/**
 * Get display name for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {string} Display name or the ID if not found
 */
export function getDisplayName(integrationId) {
  const capabilities = getCapabilities(integrationId);
  return capabilities?.displayName || integrationId;
}

/**
 * Get category mappings configuration for an integration
 * @param {string} integrationId - Integration identifier
 * @returns {{storageKey: string|null, sourceLabel: string|null}|null} Category config or null
 */
export function getCategoryMappingsConfig(integrationId) {
  const capabilities = getCapabilities(integrationId);
  if (!capabilities || !capabilities.hasCategorization) {
    return null;
  }
  return {
    storageKey: capabilities.categoryMappingsStorageKey,
    sourceLabel: capabilities.categorySourceLabel,
  };
}

/**
 * Get favicon domain for an integration.
 * Checks hardcoded FAVICON_DOMAINS first, then falls back to registry manifest.
 * @param {string} integrationId - Integration identifier
 * @returns {string|null} Domain for favicon URL or null if not found
 */
export function getFaviconDomain(integrationId) {
  if (FAVICON_DOMAINS[integrationId]) {
    return FAVICON_DOMAINS[integrationId];
  }

  // Fall back to modular integration registry manifest (lazy require to avoid circular dependency)
  const { getManifest } = require('./integrationRegistry');
  const manifest = getManifest(integrationId);
  return manifest?.faviconDomain || null;
}

/**
 * Get full Google Favicon API URL for an integration
 * @param {string} integrationId - Integration identifier
 * @param {number} size - Icon size (default 128)
 * @returns {string|null} Full favicon URL or null if domain not found
 */
export function getFaviconUrl(integrationId, size = 128) {
  const domain = getFaviconDomain(integrationId);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}

export default {
  INTEGRATIONS,
  ACCOUNT_SETTINGS,
  INTEGRATION_CAPABILITIES,
  FAVICON_DOMAINS,
  getCapabilities,
  hasCapability,
  hasSetting,
  getSettingDefault,
  getDefaultSettings,
  getAccountKeyName,
  getIntegrationsWithCapability,
  getIntegrationsWithSetting,
  getDisplayName,
  getFaviconDomain,
  getFaviconUrl,
  getCategoryMappingsConfig,
};
