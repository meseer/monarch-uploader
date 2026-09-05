/**
 * Configuration constants for the Questrade to Monarch balance uploader
 * This file will gradually replace inline constants in the original script
 */

/**
 * Get the Monarch domain
 */
function getMonarchApiDomain(): string {
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
} as const;

// Storage keys
export const STORAGE = {
  // Global settings
  DEVELOPMENT_MODE: 'development_mode', // Global development mode toggle
  // Experimental: override the columnMapping key used for the Owner CSV column.
  // Set to '' to omit the Owner column from the mapping entirely.
  MONARCH_CSV_OWNER_KEY: 'monarch_csv_owner_key',
  ACCOUNTS_LIST: 'questrade_accounts_list',
  MONARCH_CSRF_TOKEN: 'monarch_csrf_token',
  MONARCH_SESSION_EXPIRES_AT: 'monarch_session_expires_at',
  // Account lists with enhanced properties (skip flags, etc.)
  WEALTHSIMPLE_ACCOUNTS_LIST: 'wealthsimple_accounts_list',
  ROGERSBANK_ACCOUNTS_LIST: 'rogersbank_accounts_list',
  CANADALIFE_ACCOUNTS_LIST: 'canadalife_accounts_list',
  // Consolidated per-integration config (auth, settings, category mappings, holdings mappings)
  WEALTHSIMPLE_CONFIG: 'wealthsimple_config',
  QUESTRADE_CONFIG: 'questrade_config',
  CANADALIFE_CONFIG: 'canadalife_config',
  ROGERSBANK_CONFIG: 'rogersbank_config',
  // CanadaLife specific storage keys
  CANADALIFE_TOKEN_KEY: '$AuraClientService.token$siteforce:communityApp',
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
  ROGERSBANK_UPLOADED_REFS_PREFIX: 'rogersbank_uploaded_refs_', // Store uploaded transaction reference numbers
  ROGERSBANK_CATEGORY_MAPPINGS: 'rogersbank_category_mappings', // Store bank category to Monarch category mappings
  ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX: 'rogersbank_last_credit_limit_', // Store last synced credit limit per account
  ROGERSBANK_BALANCE_CHECKPOINT_PREFIX: 'rogersbank_balance_checkpoint_', // Store balance checkpoint for reconstruction
  // Lookback period storage keys (days to look back from last upload date)
  ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
} as const;

// Transaction retention defaults (for deduplication storage)
// Used for both legacy per-key storage and consolidated account structures
export const TRANSACTION_RETENTION_DEFAULTS = {
  DAYS: 91, // Keep transactions from last 91 days (must be > default lookback period)
  COUNT: 1000, // Keep last 1000 transactions
} as const;

// Wealthsimple account types processed with cash-account semantics.
// These accounts read transaction state from `unifiedStatus` on the activity
// feed, can never hold a negative balance, and have no holdings/positions.
// HISA portfolio accounts are modelled by Wealthsimple as automated portfolios
// but behave as high-interest savings accounts, so they belong here rather than
// with the investment types.
export const WEALTHSIMPLE_CASH_LIKE_TYPES = new Set([
  'CASH',
  'CASH_USD',
  'YOUTH_CASH',
  'HISA_PORTFOLIO_NON_REGISTERED',
]);

// Wealthsimple account types that support transaction upload
// These accounts have transactions that can be synced to Monarch
export const WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES = new Set([
  'CREDIT_CARD',
  'PORTFOLIO_LINE_OF_CREDIT',
  'CASH',
  'CASH_USD',
  'YOUTH_CASH',
  'HISA_PORTFOLIO_NON_REGISTERED',
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
  'SELF_DIRECTED_NON_REGISTERED_MARGIN',
]);

// Wealthsimple account types that support pending transaction reconciliation
// Subset of WEALTHSIMPLE_TRANSACTION_SUPPORTED_TYPES (excludes PORTFOLIO_LINE_OF_CREDIT)
export const WEALTHSIMPLE_PENDING_RECONCILIATION_TYPES = new Set([
  'CREDIT_CARD',
  'CASH',
  'CASH_USD',
  'YOUTH_CASH',
  'HISA_PORTFOLIO_NON_REGISTERED',
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
  'SELF_DIRECTED_NON_REGISTERED_MARGIN',
]);

// Wealthsimple account types that require balance reconstruction from transactions
// These accounts don't have balance history API support - balance must be calculated from transactions
// Note: CASH accounts get balance from API and don't need reconstruction
export const WEALTHSIMPLE_BALANCE_RECONSTRUCTION_TYPES = new Set([
  'CREDIT_CARD',
  'PORTFOLIO_LINE_OF_CREDIT',
]);

/**
 * Monarch CSV importer field names, keyed by our CSV column header.
 *
 * The importer receives a `columnMapping` of {monarchFieldName: columnIndex}
 * and reads ONLY the columns named there — an unmapped column is silently
 * ignored rather than rejected. Keys follow Monarch's snake_case convention for
 * its Transaction fields (`dataProviderDescription` → `data_provider_description`,
 * `merchant.name` → `merchant_name`).
 *
 * `Account` is intentionally absent: the target account is already passed
 * explicitly as `accountId` in the parse input, so mapping the column too risks
 * a conflict.
 */
export const MONARCH_CSV_FIELD_KEYS: Record<string, string> = {
  Date: 'date',
  Merchant: 'merchant_name',
  Category: 'category',
  'Original Statement': 'data_provider_description',
  Notes: 'notes',
  Amount: 'amount',
  Tags: 'tags',
  // Owner is resolved separately via MONARCH_CSV_OWNER_FIELD_KEY so the key can
  // be overridden at runtime while we determine what the parser accepts.
} as const;

/**
 * `columnMapping` key for the Owner column.
 *
 * Empty because **Monarch's CSV importer has no owner column**. Sending one
 * fails the whole upload:
 *
 *   "Invalid column mapping: 'owned_by_user' is not a valid column.
 *    Valid columns: ['account', 'amount', 'category',
 *    'data_provider_description', 'date', 'id', 'merchant_name', 'notes',
 *    'tags']"
 *
 * Owner is therefore applied after upload by `services/common/ownerSync`.
 * The key remains overridable via `STORAGE.MONARCH_CSV_OWNER_KEY` only so the
 * closed avenue can be re-probed if Monarch ever adds the column.
 */
export const MONARCH_CSV_OWNER_FIELD_KEY = '';

/**
 * Monarch tags used as internal processing markers.
 *
 * These drive follow-up work after a CSV upload and are removed once that work
 * completes. While ANY marker is still present on a transaction, its
 * `{prefix}:{hash}` id is retained in the notes so the transaction can still be
 * located; the step that removes the last marker also strips the id.
 *
 * That invariant is what makes the follow-up passes crash-safe: a transaction
 * whose processing was interrupted keeps both its marker and its id, so a later
 * sync can always find and finish it.
 */
export const MARKER_TAGS = {
  /** Transaction is pending; drives pending reconciliation */
  PENDING: 'Pending',
  /** Transaction still needs its Monarch owner set; drives owner sync */
  PENDING_OWNER_UPDATE: 'pendingOwnerUpdate',
} as const;

/** All marker tag names, for retention checks */
export const ALL_MARKER_TAGS: readonly string[] = Object.values(MARKER_TAGS);

/**
 * Maximum owner updates attempted in a single sync.
 *
 * Owner sync issues one mutation per transaction. A first sync can produce
 * hundreds, so the batch is capped and the remainder deferred to the next sync
 * (the marker tag makes this safe) rather than firing an unbounded burst.
 */
export const OWNER_SYNC_MAX_UPDATES_PER_SYNC = 200;

/**
 * Cardholder → Monarch owner/tag mapping constants.
 *
 * Monarch's CSV importer matches the `Owner` column against household member
 * `users[].name` values. Any unrecognised value is silently reverted to the
 * household default, so `SHARED_OWNER` is safe to emit when a cardholder has
 * no resolved household member.
 */
export const CARDHOLDER = {
  /** Owner value emitted when no household member is resolved */
  SHARED_OWNER: 'Shared',
  /** Owner mapping modes */
  OWNER_MODE: {
    OFF: 'off',
    ON: 'on',
  },
  /** Cardholder tag modes */
  TAG_MODE: {
    OFF: 'off',
    /** Tag only once 2+ distinct cardholders have ever been discovered */
    AUTO: 'auto',
    ALWAYS: 'always',
  },
} as const;

// Account status constants
export const ACCOUNT_STATUS = {
  ACTIVE: 'active', // Account is active and returned by API
  CLOSED: 'closed', // Account is closed (in storage but not in API)
} as const;

// Brand colors
export const COLORS = {
  CANADALIFE_BRAND: '#A20A29',
  QUESTRADE_BRAND: '#0073b1',
  ROGERSBANK_BRAND: '#DA291C', // Rogers red
  WEALTHSIMPLE_BRAND: 'rgb(50, 48, 47)', // Wealthsimple dark gray
} as const;

// Cloudinary public IDs for institution logos (pre-uploaded to Monarch)
// These are used to set logos for manually created accounts
export const LOGO_CLOUDINARY_IDS = {
  WEALTHSIMPLE: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/qpy5muxbdwcuzpq2krap',
  ROGERS: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/bqobv1ada0bjpyg5gnio',
  CANADALIFE: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/pvkztvf863k4btje6tal',
  QUESTRADE: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/dyk2dqsh5q8txe76duml',
} as const;

// UI settings
export const UI = {
  TOAST_DURATION: 5000, // 5 seconds for toast notifications
  TOKEN_CACHE_DURATION: 5000, // 5 seconds for token cache
  ANIMATION_DURATION: 200, // Duration for UI animations (ms)
} as const;

/**
 * Wealthsimple UI injection settings
 *
 * Injection points are tried in order - first matching selector wins.
 * Each injection point specifies a CSS selector and an insert method.
 *
 * Supported insertMethod values:
 * - 'prepend': Insert UI as the first child of the matched element
 * - 'prependToSecondChild': Navigate to the second child of the matched element,
 *   then insert UI as its first child
 * - 'insertBefore': Insert UI as the previous sibling of the matched element
 *   (injects into the parent, before the target)
 */
export const WEALTHSIMPLE_UI = {
  // XPath: //*[@id="main"]/div/div/div[2]/div[2]
  INJECTION_POINTS: [
    { selector: 'last:.kOjAGq', insertMethod: 'prepend' },
    { selector: '.bZQXKE', insertMethod: 'prepend' },
  ],
} as const;

// Default export with all config values
