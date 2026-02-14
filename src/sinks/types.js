/**
 * Data Sink Type Definitions
 *
 * JSDoc typedefs defining the standard interface that every data sink
 * (destination) must implement. A data sink receives normalized financial
 * data and persists it to a specific platform.
 *
 * The first implementation is Monarch Money. Future sinks could include
 * Actual Budget, a custom backend, or any other financial data destination.
 *
 * @module sinks/types
 */

// ============================================================
// DATA SINK INTERFACE
// ============================================================

/**
 * @typedef {Object} DataSink
 * A pluggable data destination that receives financial data from
 * the sync orchestrator and persists it to a specific platform.
 *
 * @property {string} id - Unique sink identifier (e.g., 'monarch')
 * @property {string} displayName - Human-readable name (e.g., 'Monarch Money')
 *
 * // Authentication
 * @property {function(): Promise<boolean>} checkAuth - Check if authenticated with the sink
 * @property {function(): void} setupTokenCapture - Set up token/auth capture (e.g., on the sink's website)
 * @property {function(): string|null} getToken - Get current auth token
 *
 * // Account operations
 * @property {function(): Promise<SinkAccount[]>} getAccounts - Get all accounts from the sink
 * @property {function(Object): Promise<SinkAccount>} createAccount - Create a new account in the sink
 *
 * // Balance operations
 * @property {function(string, string): Promise<Object>} uploadBalanceHistory -
 *   Upload balance history CSV (sinkAccountId, csvData) → upload result
 * @property {function(string, number): Promise<void>} updateBalance -
 *   Update current balance for an account (sinkAccountId, balance)
 *
 * // Transaction operations
 * @property {function(string, string): Promise<Object>} uploadTransactions -
 *   Upload transactions CSV (sinkAccountId, csvData) → upload result
 *
 * // Holdings operations
 * @property {function(string): Promise<SinkHolding[]>} getHoldings -
 *   Get all holdings for an account (sinkAccountId)
 * @property {function(string, Object): Promise<Object>} upsertHolding -
 *   Create or update a holding (sinkAccountId, holdingData)
 * @property {function(string): Promise<SinkSecurity[]>} getSecurities -
 *   Search/list securities available in the sink
 *
 * // Category operations
 * @property {function(): Promise<SinkCategory[]>} getCategories -
 *   Get all categories and category groups from the sink
 *
 * // Credit limit
 * @property {function(string, number): Promise<void>} updateCreditLimit -
 *   Update credit limit for an account (sinkAccountId, limit)
 */

// ============================================================
// SINK DATA TYPES
// ============================================================

/**
 * @typedef {Object} SinkAccount
 * An account in the data sink.
 *
 * @property {string} id - Sink-specific account ID
 * @property {string} displayName - Account display name
 * @property {string} [type] - Account type (e.g., 'checking', 'investment', 'credit_card')
 * @property {string} [subtype] - Account subtype
 * @property {number} [balance] - Current balance
 * @property {string} [institution] - Institution name
 * @property {string} [logoUrl] - Account logo URL
 */

/**
 * @typedef {Object} SinkHolding
 * A security holding in the data sink.
 *
 * @property {string} id - Sink-specific holding ID
 * @property {string} securityId - Sink-specific security ID
 * @property {string} [symbol] - Ticker symbol
 * @property {string} [name] - Security name
 * @property {number} [quantity] - Number of shares/units
 * @property {number} [value] - Current market value
 * @property {number} [costBasis] - Cost basis
 */

/**
 * @typedef {Object} SinkSecurity
 * A security available in the data sink.
 *
 * @property {string} id - Sink-specific security ID
 * @property {string} symbol - Ticker symbol
 * @property {string} name - Security name
 * @property {string} [type] - Security type (e.g., 'stock', 'etf', 'mutual_fund')
 * @property {string} [exchange] - Exchange name
 */

/**
 * @typedef {Object} SinkCategory
 * A transaction category in the data sink.
 *
 * @property {string} id - Sink-specific category ID
 * @property {string} name - Category name
 * @property {string} [group] - Category group name
 * @property {string} [icon] - Category icon
 */

// ============================================================
// FACTORY
// ============================================================

/**
 * Factory function signature for creating a data sink.
 *
 * @callback CreateSinkFunction
 * @param {import('../core/httpClient').HttpClient} httpClient - Injected HTTP client
 * @param {import('../core/storageAdapter').StorageAdapter} storage - Injected storage adapter
 * @returns {DataSink} Data sink instance
 */

// This file is types-only — no runtime exports needed.
// The typedefs above are consumed via JSDoc @type annotations
// in the actual implementation files.
export default {};