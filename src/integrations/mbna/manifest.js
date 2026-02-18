/**
 * MBNA Integration Manifest
 *
 * Declares everything the core needs to know about the MBNA integration
 * without instantiating any of its components. This is the reference
 * implementation of the IntegrationManifest contract.
 *
 * @type {import('../types').IntegrationManifest}
 * @module integrations/mbna/manifest
 */

/** @type {import('../types').IntegrationManifest} */
const manifest = {
  // ── Identity ──────────────────────────────────────────────
  id: 'mbna',
  displayName: 'MBNA',
  faviconDomain: 'mbna.ca',

  // ── Site matching ─────────────────────────────────────────
  matchDomains: ['service.mbna.ca'],
  matchUrls: ['https://service.mbna.ca/*'],

  // ── Storage keys ──────────────────────────────────────────
  storageKeys: {
    accountsList: 'mbna_accounts_list',
    config: 'mbna_config',
    cache: null,
  },

  // ── Config schema ─────────────────────────────────────────
  configSchema: {
    auth: ['sessionActive', 'accountNumber', 'lastChecked'],
    settings: ['lookbackDays'],
    hasCategoryMappings: true,
    hasHoldingsMappings: false,
  },

  // ── Capabilities (feature flags) ─────────────────────────
  capabilities: {
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: true,
    hasHoldings: false,
    hasBalanceReconstruction: true,
    hasCategorization: true,
  },

  // ── Category mapping config ───────────────────────────────
  categoryConfig: {
    sourceLabel: 'Bank Category',
  },

  // ── Per-account settings ──────────────────────────────────
  accountKeyName: 'mbnaAccount',
  settings: [
    { key: 'storeTransactionDetailsInNotes', default: false },
    { key: 'transactionRetentionDays', default: 91 },
    { key: 'transactionRetentionCount', default: 1000 },
    { key: 'includePendingTransactions', default: true },
    { key: 'invertBalance', default: false },
    { key: 'skipCategorization', default: false },
  ],

  // ── Brand theming ─────────────────────────────────────────
  brandColor: '#003087',
  logoCloudinaryId: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/uyjbhlklztevwjlpmj0n',

  // ── UI extensions ─────────────────────────────────────────
  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};

export default manifest;