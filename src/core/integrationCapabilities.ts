/**
 * Integration Capabilities Configuration
 *
 * Defines what each integration supports in terms of features and settings.
 * Used by the settings UI to dynamically render appropriate options.
 */

import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from './config';
import type { IntegrationManifest } from '../integrations/types';

/**
 * Integration identifiers
 */
export const INTEGRATIONS = {
  WEALTHSIMPLE: 'wealthsimple',
  QUESTRADE: 'questrade',
  CANADALIFE: 'canadalife',
  ROGERSBANK: 'rogersbank',
  MBNA: 'mbna',
} as const;

/**
 * Favicon domains for each integration
 * Used to fetch logos via Google Favicon API
 */
export const FAVICON_DOMAINS: Record<string, string> = {
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
} as const;

/**
 * Capabilities configuration for each integration
 */
export interface LegacyIntegrationCapabilities {
  id: string;
  displayName: string;
  accountKeyName: string;
  configStorageKey: string | null;
  hasTransactions: boolean;
  hasDeduplication: boolean;
  hasBalanceHistory: boolean;
  hasCreditLimit: boolean;
  hasHoldings: boolean;
  hasBalanceReconstruction: boolean;
  hasCategorization: boolean;
  categoryMappingsStorageKey: string | null;
  categorySourceLabel: string | null;
  settings: string[];
  settingDefaults: Record<string, unknown>;
}

/**
 * Integration capabilities definitions
 */
export const INTEGRATION_CAPABILITIES: Record<string, LegacyIntegrationCapabilities> = {
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
 */
function buildCapabilitiesFromManifest(manifest: IntegrationManifest): LegacyIntegrationCapabilities {
  const settingKeys = (manifest.settings || []).map((s) => s.key);
  const settingDefaults: Record<string, unknown> = {};
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
 */
export function getCapabilities(integrationId: string): LegacyIntegrationCapabilities | null {
  // Check hardcoded legacy capabilities first
  if (INTEGRATION_CAPABILITIES[integrationId]) {
    return INTEGRATION_CAPABILITIES[integrationId];
  }

  // Fall back to modular integration registry manifest (lazy require to avoid circular dependency)
  // Chain: integrationCapabilities → integrationRegistry → utils → configStore → integrationCapabilities
  const { getManifest } = require('./integrationRegistry');
  const manifest = getManifest(integrationId);
  if (manifest) {
    return buildCapabilitiesFromManifest(manifest);
  }

  return null;
}

/**
 * Check if an integration supports a specific capability
 */
export function hasCapability(integrationId: string, capability: string): boolean {
  const capabilities = getCapabilities(integrationId);
  return capabilities ? Boolean((capabilities as unknown as Record<string, unknown>)[capability]) : false;
}

/**
 * Check if an integration supports a specific setting
 */
export function hasSetting(integrationId: string, settingKey: string): boolean {
  const capabilities = getCapabilities(integrationId);
  return capabilities ? capabilities.settings.includes(settingKey) : false;
}

/**
 * Get default value for a specific setting
 */
export function getSettingDefault(integrationId: string, settingKey: string): unknown {
  const capabilities = getCapabilities(integrationId);
  if (!capabilities || !capabilities.settingDefaults) {
    return undefined;
  }
  return capabilities.settingDefaults[settingKey];
}

/**
 * Get all settings with their defaults for an integration
 */
export function getDefaultSettings(integrationId: string): Record<string, unknown> {
  const capabilities = getCapabilities(integrationId);
  return capabilities?.settingDefaults || {};
}

/**
 * Get the account key name for an integration
 * Used to access the source account data in consolidated structure
 */
export function getAccountKeyName(integrationId: string): string | null {
  const capabilities = getCapabilities(integrationId);
  return capabilities?.accountKeyName || null;
}

/**
 * Get all integrations that support a specific capability
 */
export function getIntegrationsWithCapability(capability: string): string[] {
  return Object.keys(INTEGRATION_CAPABILITIES).filter(
    (id) => (INTEGRATION_CAPABILITIES[id] as unknown as Record<string, unknown>)[capability],
  );
}

/**
 * Get all integrations that support a specific setting
 */
export function getIntegrationsWithSetting(settingKey: string): string[] {
  return Object.keys(INTEGRATION_CAPABILITIES).filter(
    (id) => INTEGRATION_CAPABILITIES[id].settings.includes(settingKey),
  );
}

/**
 * Get display name for an integration
 */
export function getDisplayName(integrationId: string): string {
  const capabilities = getCapabilities(integrationId);
  return capabilities?.displayName || integrationId;
}

/**
 * Get category mappings configuration for an integration
 */
export function getCategoryMappingsConfig(integrationId: string): { storageKey: string | null; sourceLabel: string | null } | null {
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
 */
export function getFaviconDomain(integrationId: string): string | null {
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
 */
export function getFaviconUrl(integrationId: string, size: number = 128): string | null {
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