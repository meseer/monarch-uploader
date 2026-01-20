/**
 * Configuration constants for the Questrade to Monarch balance uploader
 * This file will gradually replace inline constants in the original script
 */

// Debug settings
export const DEBUG_LOG = true;

/**
 * Get the Monarch domain
 * @returns {string} The Monarch domain to use
 */
function getMonarchApiDomain() {
  return 'monarch.com';
}

// Determine domain once at module load
const monarchDomain = getMonarchApiDomain();

// API Endpoints - dynamically constructed based on detected domain
export const API = {
  QUESTRADE_BASE_URL: 'https://api.questrade.com',
  WEALTHSIMPLE_GRAPHQL_URL: 'https://my.wealthsimple.com/graphql',
  WEALTHSIMPLE_TOKEN_INFO_URL: 'https://api.production.wealthsimple.com/v1/oauth/v2/token/info',
  MONARCH_GRAPHQL_URL: `https://api.${monarchDomain}/graphql`,
  MONARCH_TRANSACTIONS_UPLOAD_URL: `https://api.${monarchDomain}/statements/upload-async/`,
  MONARCH_BALANCE_UPLOAD_URL: `https://api.${monarchDomain}/account-balance-history/upload/`,
  MONARCH_APP_URL: `https://app.${monarchDomain}`,
};

// Storage keys
// TODO: Future migration - Questrade, Rogers Bank, and CanadaLife should migrate
// to a consolidated account structure like Wealthsimple uses (wealthsimple_accounts_list).
// This will allow storing all account-specific settings (retention, mappings, etc.)
// in a single unified structure per institution instead of scattered storage keys.
export const STORAGE = {
  ACCOUNTS_LIST: 'questrade_accounts_list',
  MONARCH_TOKEN: 'monarch_graphql_token',
  // Account lists with enhanced properties (skip flags, etc.)
  WEALTHSIMPLE_ACCOUNTS_LIST: 'wealthsimple_accounts_list',
  ROGERSBANK_ACCOUNTS_LIST: 'rogersbank_accounts_list',
  CANADALIFE_ACCOUNTS_LIST: 'canadalife_accounts_list',
  // Questrade specific storage keys
  QUESTRADE_LAST_UPLOAD_DATE_PREFIX: 'questrade_last_upload_date_',
  QUESTRADE_ACCOUNT_MAPPING_PREFIX: 'questrade_monarch_account_for_',
  QUESTRADE_HOLDINGS_FOR_PREFIX: 'questrade_holdings_for_',
  QUESTRADE_UPLOADED_ORDERS_PREFIX: 'questrade_uploaded_orders_', // Store uploaded order UUIDs per account
  QUESTRADE_ORDER_CATEGORY_MAPPINGS: 'questrade_order_category_mappings', // Store order action to Monarch category mappings
  // CanadaLife specific storage keys
  CANADALIFE_TOKEN_KEY: '$AuraClientService.token$siteforce:communityApp',
  CANADALIFE_LAST_UPLOAD_DATE_PREFIX: 'canadalife_last_upload_date_',
  CANADALIFE_ACCOUNT_MAPPING_PREFIX: 'canadalife_monarch_account_for_',
  // Rogers Bank specific storage keys
  ROGERSBANK_AUTH_TOKEN: 'rogersbank_auth_token',
  ROGERSBANK_ACCOUNT_ID: 'rogersbank_account_id',
  ROGERSBANK_CUSTOMER_ID: 'rogersbank_customer_id',
  ROGERSBANK_ACCOUNT_ID_ENCODED: 'rogersbank_account_id_encoded',
  ROGERSBANK_CUSTOMER_ID_ENCODED: 'rogersbank_customer_id_encoded',
  ROGERSBANK_DEVICE_ID: 'rogersbank_device_id',
  ROGERSBANK_LAST_UPDATED: 'rogersbank_last_updated',
  ROGERSBANK_LAST_UPLOAD_DATE_PREFIX: 'rogersbank_last_upload_date_',
  ROGERSBANK_ACCOUNT_MAPPING_PREFIX: 'rogersbank_monarch_account_for_',
  ROGERSBANK_FROM_DATE: 'rogersbank_from_date',
  ROGERSBANK_UPLOADED_REFS_PREFIX: 'rogersbank_uploaded_refs_', // Store uploaded transaction reference numbers
  ROGERSBANK_CATEGORY_MAPPINGS: 'rogersbank_category_mappings', // Store bank category to Monarch category mappings
  ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX: 'rogersbank_last_credit_limit_', // Store last synced credit limit per account
  ROGERSBANK_BALANCE_CHECKPOINT_PREFIX: 'rogersbank_balance_checkpoint_', // Store balance checkpoint for reconstruction
  // Wealthsimple specific storage keys
  WEALTHSIMPLE_AUTH_TOKEN: 'wealthsimple_auth_token',
  WEALTHSIMPLE_ACCESS_TOKEN: 'wealthsimple_access_token',
  WEALTHSIMPLE_IDENTITY_ID: 'wealthsimple_identity_id',
  WEALTHSIMPLE_TOKEN_EXPIRES_AT: 'wealthsimple_token_expires_at',
  WEALTHSIMPLE_INVEST_PROFILE: 'wealthsimple_invest_profile',
  WEALTHSIMPLE_TRADE_PROFILE: 'wealthsimple_trade_profile',
  WEALTHSIMPLE_CATEGORY_MAPPINGS: 'wealthsimple_category_mappings', // Shared across all Wealthsimple accounts
  // Lookback period storage keys (days to look back from last upload date)
  QUESTRADE_LOOKBACK_DAYS: 'questrade_lookback_days',
  CANADALIFE_LOOKBACK_DAYS: 'canadalife_lookback_days',
  ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
  WEALTHSIMPLE_LOOKBACK_DAYS: 'wealthsimple_lookback_days',
  // Transaction retention settings (separate from lookback - for deduplication)
  QUESTRADE_TRANSACTION_RETENTION_DAYS: 'questrade_transaction_retention_days',
  QUESTRADE_TRANSACTION_RETENTION_COUNT: 'questrade_transaction_retention_count',
  ROGERSBANK_TRANSACTION_RETENTION_DAYS: 'rogersbank_transaction_retention_days',
  ROGERSBANK_TRANSACTION_RETENTION_COUNT: 'rogersbank_transaction_retention_count',
};

// Transaction retention defaults (for deduplication storage)
// Used for both legacy per-key storage and consolidated account structures
export const TRANSACTION_RETENTION_DEFAULTS = {
  DAYS: 91, // Keep transactions from last 91 days (must be > default lookback period)
  COUNT: 1000, // Keep last 1000 transactions
};

// Wealthsimple account types that support transaction upload
// These accounts have transactions that can be synced to Monarch
export const WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES = new Set([
  'CREDIT_CARD',
  'PORTFOLIO_LINE_OF_CREDIT',
  'CASH',
  'CASH_USD',
  // Investment accounts - Managed
  'MANAGED_RESP_FAMILY',
  'MANAGED_RESP',
  'MANAGED_NON_REGISTERED',
  'MANAGED_TFSA',
  'MANAGED_RRSP',
  // Investment accounts - Self-directed
  'SELF_DIRECTED_RESP_FAMILY',
  'SELF_DIRECTED_RESP',
  'SELF_DIRECTED_NON_REGISTERED',
  'SELF_DIRECTED_TFSA',
  'SELF_DIRECTED_RRSP',
  'SELF_DIRECTED_CRYPTO',
]);

// Wealthsimple account types that require balance reconstruction from transactions
// These accounts don't have balance history API support - balance must be calculated from transactions
// Note: CASH accounts get balance from API and don't need reconstruction
export const WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES = new Set([
  'CREDIT_CARD',
  'PORTFOLIO_LINE_OF_CREDIT',
]);

// Brand colors
export const COLORS = {
  CANADALIFE_BRAND: '#A20A29',
  QUESTRADE_BRAND: '#0073b1',
  ROGERSBANK_BRAND: '#DA291C', // Rogers red
  WEALTHSIMPLE_BRAND: 'rgb(50, 48, 47)', // Wealthsimple dark gray
};

// Cloudinary public IDs for institution logos (pre-uploaded to Monarch)
// These are used to set logos for manually created accounts
export const LOGO_CLOUDINARY_IDS = {
  WEALTHSIMPLE: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/qpy5muxbdwcuzpq2krap',
  ROGERS: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/bqobv1ada0bjpyg5gnio',
  CANADALIFE: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/pvkztvf863k4btje6tal',
  QUESTRADE: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/dyk2dqsh5q8txe76duml',
};

// UI settings
export const UI = {
  TOAST_DURATION: 5000, // 5 seconds for toast notifications
  TOKEN_CACHE_DURATION: 5000, // 5 seconds for token cache
  ANIMATION_DURATION: 200, // Duration for UI animations (ms)
};

// Default export with all config values
export default {
  DEBUG_LOG,
  API,
  STORAGE,
  TRANSACTION_RETENTION_DEFAULTS,
  COLORS,
  LOGO_CLOUDINARY_IDS,
  UI,
};
