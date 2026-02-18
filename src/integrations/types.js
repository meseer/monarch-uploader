/**
 * Integration Module Type Definitions
 *
 * JSDoc typedefs defining the standard interface that every integration
 * module must implement. These types serve as the contract between
 * integration modules and the core orchestrator.
 *
 * Integration modules are self-contained API libraries for financial
 * institutions. They are Tampermonkey-agnostic — all platform-specific
 * capabilities (HTTP requests, storage) are injected via adapters.
 *
 * @module integrations/types
 */

// ============================================================
// MANIFEST
// ============================================================

/**
 * @typedef {Object} IntegrationManifest
 * Declares everything the core needs to know about an integration
 * without instantiating any of its components.
 *
 * @property {string} id - Unique integration identifier (e.g., 'wealthsimple')
 * @property {string} displayName - Human-readable name (e.g., 'Wealthsimple')
 * @property {string} faviconDomain - Domain for Google Favicon API (e.g., 'wealthsimple.com')
 *
 * @property {string[]} matchDomains - Hostname fragments for site detection (e.g., ['wealthsimple.com'])
 * @property {string[]} matchUrls - Full @match patterns for userscript metadata (e.g., ['https://my.wealthsimple.com/*'])
 *
 * @property {IntegrationStorageKeys} storageKeys - Storage key configuration
 * @property {IntegrationConfigSchema} configSchema - Schema for the consolidated config object
 *
 * @property {IntegrationCapabilities} capabilities - Feature flags
 * @property {IntegrationCategoryConfig|null} categoryConfig - Category mapping configuration (null if no categorization)
 *
 * @property {string|null} [txIdPrefix] - Prefix for generated pending transaction IDs (e.g., 'mbna-tx'). Required if hasDeduplication + pending support.
 *
 * @property {string} accountKeyName - Key name for source account in consolidated storage (e.g., 'wealthsimpleAccount')
 * @property {IntegrationSettingDefinition[]} settings - Per-account settings with defaults
 *
 * @property {string} brandColor - CSS color for brand theming
 * @property {string|null} logoCloudinaryId - Cloudinary public ID for institution logo (null if none)
 *
 * @property {IntegrationUIExtensions} uiExtensions - Optional UI extension flags
 */

/**
 * @typedef {Object} IntegrationStorageKeys
 * @property {string} accountsList - Key for the consolidated accounts list (e.g., 'wealthsimple_accounts_list')
 * @property {string} config - Key for the consolidated config object (e.g., 'wealthsimple_config')
 * @property {string|null} [cache] - Key for volatile/regenerable cache data (optional)
 */

/**
 * @typedef {Object} IntegrationConfigSchema
 * Describes the shape of the consolidated config object stored under storageKeys.config.
 *
 * @property {string[]} auth - List of auth-related field names stored in config.auth
 * @property {string[]} settings - List of global setting field names stored in config.settings
 * @property {boolean} hasCategoryMappings - Whether config stores category mappings
 * @property {boolean} hasHoldingsMappings - Whether config stores institution-level holdings mappings
 */

/**
 * @typedef {Object} IntegrationCapabilities
 * Feature flags indicating what the integration supports.
 *
 * @property {boolean} hasTransactions - Supports transaction upload
 * @property {boolean} hasDeduplication - Needs transaction deduplication
 * @property {boolean} hasBalanceHistory - Supports balance history upload
 * @property {boolean} hasCreditLimit - Supports credit limit sync
 * @property {boolean} hasHoldings - Supports holdings/positions sync
 * @property {boolean} hasBalanceReconstruction - Balance can be reconstructed from transactions
 * @property {boolean} hasCategorization - Supports category mappings (merchant → Monarch category)
 */

/**
 * @typedef {Object} IntegrationCategoryConfig
 * @property {string} sourceLabel - Label for the source column in category mapping UI (e.g., 'Merchant Name', 'Bank Category')
 */

/**
 * @typedef {Object} IntegrationSettingDefinition
 * Defines a per-account setting available for this integration.
 *
 * @property {string} key - Setting key (e.g., 'storeTransactionDetailsInNotes')
 * @property {*} default - Default value for new accounts
 */

/**
 * @typedef {Object} IntegrationUIExtensions
 * Optional flags for UI features beyond the standard panel.
 *
 * @property {boolean} [showTokenExpiry=false] - Show token expiry countdown in status
 * @property {boolean} [showTestingSection=false] - Show dev-mode testing section
 */

// ============================================================
// INJECTION POINT
// ============================================================

/**
 * @typedef {Object} IntegrationInjectionPoint
 * Configuration for how and where to inject the uploader UI
 * on the institution's website.
 *
 * @property {InjectionSelector[]} selectors - CSS selectors tried in order to find injection target
 * @property {boolean} isSPA - Whether the site is a SPA requiring MutationObserver monitoring
 * @property {PageMode[]} pageModes - Page modes defining what UI to show based on URL
 * @property {RegExp[]} appPagePatterns - URL patterns indicating valid app pages
 * @property {RegExp[]} skipPatterns - URL patterns to skip (login, loading screens)
 * @property {string} containerId - DOM ID for the injected UI container
 */

/**
 * @typedef {Object} InjectionSelector
 * @property {string} selector - CSS selector to find the target element
 * @property {string} insertMethod - How to insert: 'prepend', 'append', 'insertBefore', 'prependToSecondChild'
 */

/**
 * @typedef {Object} PageMode
 * @property {string} id - Unique mode identifier (e.g., 'single-account', 'all-accounts', 'dashboard')
 * @property {RegExp} urlPattern - URL pattern to match for this mode
 * @property {function} [extractAccountId] - Optional function: (regexMatch) => accountId string
 * @property {string} uiType - UI type to render: 'single-account' or 'all-accounts'
 */

// ============================================================
// API CLIENT
// ============================================================

/**
 * @typedef {Object} IntegrationApi
 * Institution API client. All methods return raw institution data —
 * no Monarch-specific transformation happens here.
 *
 * Not all methods are required; presence depends on capabilities.
 *
 * @property {function(): Promise<Object[]>} getAccounts - Fetch all accounts
 * @property {function(string): Promise<Object>} [getBalance] - Fetch current balance for an account
 * @property {function(string, string, string): Promise<Object[]>} [getBalanceHistory] - Fetch balance history (accountId, startDate, endDate)
 * @property {function(string, string, string): Promise<Object[]>} [getTransactions] - Fetch transactions (accountId, startDate, endDate)
 * @property {function(string): Promise<Object[]>} [getPositions] - Fetch positions/holdings for an account
 * @property {function(string): Promise<number|null>} [getCreditLimit] - Fetch credit limit for an account
 */

/**
 * Factory function signature for creating an API client.
 *
 * @callback CreateApiFunction
 * @param {import('../core/httpClient').HttpClient} httpClient - Injected HTTP client
 * @param {import('../core/storageAdapter').StorageAdapter} storage - Injected storage adapter
 * @returns {IntegrationApi} API client instance
 */

// ============================================================
// AUTH HANDLER
// ============================================================

/**
 * @typedef {Object} IntegrationAuth
 * Handles credential/token capture and monitoring for the institution.
 *
 * @property {function(): void} setupMonitoring - Start token/credential monitoring (cookie parsing, XHR interception, etc.)
 * @property {function(): Object} checkStatus - Check current auth status, returns auth info object
 * @property {function(): Object|null} getCredentials - Get current credentials/token for API calls
 * @property {function(): void} clearCredentials - Clear stored credentials
 * @property {number|null} pollingInterval - Interval (ms) for periodic auth checks, or null for event-driven
 */

/**
 * Factory function signature for creating an auth handler.
 *
 * @callback CreateAuthFunction
 * @param {import('../core/storageAdapter').StorageAdapter} storage - Injected storage adapter
 * @returns {IntegrationAuth} Auth handler instance
 */

// ============================================================
// ENRICHMENT FETCHER
// ============================================================

/**
 * @typedef {Object} IntegrationEnrichment
 * Fetches supplementary data for transactions that the basic transaction
 * list doesn't include (e.g., order details, transfer annotations).
 *
 * @property {function(Object[], Object=): Promise<Map>} fetchEnrichmentData -
 *   Fetch enrichment data for transactions.
 *   Args: (transactions, { onProgress: (stepName, current, total) => void })
 *   Returns: Map keyed by transaction externalCanonicalId
 */

/**
 * Factory function signature for creating an enrichment fetcher.
 *
 * @callback CreateEnrichmentFunction
 * @param {IntegrationApi} api - The integration's API client
 * @returns {IntegrationEnrichment} Enrichment fetcher instance
 */

// ============================================================
// MONARCH MAPPER (sink-specific data transformation)
// ============================================================

/**
 * @typedef {Object} IntegrationMonarchMapper
 * Transforms raw institution data into Monarch-compatible format.
 * Explicitly coupled to Monarch's data model.
 *
 * @property {function(Object, Map=): Object|null} applyTransactionRule -
 *   Apply matching rule to transform a raw transaction.
 *   Args: (rawTransaction, enrichmentMap)
 *   Returns: { category, merchant, originalStatement, notes, technicalDetails, ... } or null if no rule matches
 *
 * @property {function(string, string): boolean} [hasRuleForTransaction] -
 *   Quick check if a rule exists for a transaction type/subType combination
 */

// ============================================================
// INTEGRATION MODULE (barrel export shape)
// ============================================================

/**
 * @typedef {Object} IntegrationModule
 * The shape of an integration module's barrel export (index.js).
 * This is what `src/integrations/index.js` imports for each integration.
 *
 * @property {IntegrationManifest} manifest - Integration manifest
 * @property {CreateApiFunction} createApi - Factory for API client
 * @property {CreateAuthFunction} createAuth - Factory for auth handler
 * @property {CreateEnrichmentFunction} [createEnrichment] - Factory for enrichment fetcher (optional)
 * @property {IntegrationInjectionPoint} injectionPoint - UI injection point config
 * @property {IntegrationMonarchMapper} [monarchMapper] - Monarch data mapper (optional)
 */

// ============================================================
// SYNC HOOKS (orchestrator contract)
// ============================================================

/**
 * @typedef {Object} SyncHooks
 * Minimal set of institution-specific hooks that the generic
 * syncOrchestrator calls during the sync workflow.
 *
 * Everything generic (CSV generation, filename, balance sign,
 * dedup filtering, reconciliation algorithm, upload) stays in
 * the orchestrator or common services. Only truly institution-
 * specific logic is exposed as hooks.
 *
 * Required hooks:
 * @property {FetchTransactionsHook} fetchTransactions - Fetch raw transactions from institution API
 * @property {ProcessTransactionsHook} processTransactions - Normalize raw transactions into orchestrator-compatible shape
 * @property {GetSettledRefIdHook} getSettledRefId - Extract dedup reference ID from a settled transaction
 * @property {GetPendingRefIdHook} getPendingRefId - Extract dedup reference ID from a pending transaction
 * @property {ResolveCategoriesHook} resolveCategories - Resolve Monarch categories for transactions
 * @property {BuildTransactionNotesHook} buildTransactionNotes - Build notes string for a transaction CSV row
 *
 * Optional hooks (capability-dependent):
 * @property {GetPendingIdFieldsHook} [getPendingIdFields] - Stable fields for pending transaction ID hashing
 * @property {BuildBalanceHistoryHook} [buildBalanceHistory] - Build balance history for first-sync reconstruction
 */

/**
 * Fetch raw transactions from the institution API.
 *
 * Returns raw settled + pending arrays plus any metadata the integration
 * needs for later steps (e.g., statements for balance reconstruction).
 *
 * @callback FetchTransactionsHook
 * @param {Object} api - Integration API client
 * @param {string} accountId - Source account ID
 * @param {string} fromDate - Start date (YYYY-MM-DD)
 * @param {Object} callbacks - Progress callbacks
 * @param {function(string): void} callbacks.onProgress - Progress message callback
 * @returns {Promise<{settled: Array, pending: Array, metadata: Object}>}
 *   metadata is integration-specific (e.g., { statements, currentCycle } for MBNA)
 */

/**
 * Process raw transactions into a normalized shape for the orchestrator.
 *
 * Each returned transaction MUST have these fields:
 *   { date, merchant, originalStatement, amount, referenceNumber,
 *     isPending, pendingId, autoCategory }
 *
 * Conventions:
 * - `amount` must be Monarch-sign-normalized (charges negative, payments positive)
 * - `merchant` should be display-ready (applyMerchantMapping already applied)
 * - `autoCategory` is non-null only if an auto-rule matched (e.g., "PAYMENT" → "Credit Card Payment")
 * - `referenceNumber` is the institution's unique transaction ID (empty for pending)
 * - `pendingId` is the generated hash ID for pending transactions (null for settled)
 *
 * @callback ProcessTransactionsHook
 * @param {Array} settled - Raw settled transactions from fetchTransactions
 * @param {Array} pending - Raw pending transactions from fetchTransactions
 * @param {Object} options - Processing options
 * @param {boolean} options.includePending - Whether to include pending transactions
 * @returns {{settled: Array, pending: Array}}
 */

/**
 * Extract the dedup reference ID from a settled transaction.
 *
 * @callback GetSettledRefIdHook
 * @param {Object} tx - Processed settled transaction
 * @returns {string} Reference ID (e.g., referenceNumber)
 */

/**
 * Extract the dedup reference ID from a pending transaction.
 *
 * @callback GetPendingRefIdHook
 * @param {Object} tx - Processed pending transaction
 * @returns {string} Reference ID (e.g., pendingId hash)
 */

/**
 * Resolve Monarch categories for transactions.
 *
 * Uses the integration's category resolution flow (stored mappings,
 * auto-match, manual prompt). Returns transactions with
 * `resolvedMonarchCategory` set.
 *
 * @callback ResolveCategoriesHook
 * @param {Array} transactions - Processed transactions needing category resolution
 * @param {string} accountId - Source account ID (for per-account settings)
 * @returns {Promise<Array>} Transactions with resolvedMonarchCategory set
 */

/**
 * Build the notes string for a single transaction's CSV row.
 *
 * Notes format differs per institution (e.g., MBNA stores referenceNumber
 * for settled, pendingId for pending; Wealthsimple has multi-line memo +
 * technical details + ws-tx: ID).
 *
 * @callback BuildTransactionNotesHook
 * @param {Object} tx - Processed transaction
 * @param {Object} options - Options
 * @param {boolean} options.storeTransactionDetailsInNotes - User setting
 * @returns {string} Notes string for the CSV row
 */

/**
 * Get the set of stable field values to hash for pending transaction ID generation.
 *
 * The orchestrator (via pendingReconciliation service) handles the actual
 * SHA-256 hashing. The hook just provides the ordered field values that
 * should be hashed for this institution's transactions.
 *
 * Required when the integration supports pending transactions.
 *
 * @callback GetPendingIdFieldsHook
 * @param {Object} tx - Raw transaction from the institution API
 * @returns {Array<string>} Ordered field values to concatenate and hash
 */

/**
 * Build balance history from statement/transaction data for first-sync reconstruction.
 *
 * Required when capabilities.hasBalanceReconstruction is true.
 *
 * @callback BuildBalanceHistoryHook
 * @param {Object} params - Parameters
 * @param {number} params.currentBalance - Current raw balance from source
 * @param {Object} params.metadata - Metadata from fetchTransactions (e.g., statements, currentCycle)
 * @param {string} params.fromDate - Start date for reconstruction
 * @param {boolean} params.invertBalance - Whether invertBalance setting is enabled
 * @returns {Array<{date: string, amount: number}>|null} Balance history entries or null
 */

// This file is types-only — no runtime exports needed.
// The typedefs above are consumed via JSDoc @type annotations
// in the actual implementation files.
export default {};
