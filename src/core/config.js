/**
 * Configuration constants for the Questrade to Monarch balance uploader
 * This file will gradually replace inline constants in the original script
 */

// Debug settings
export const DEBUG_LOG = true;

/**
 * MIGRATION: Detect which Monarch domain we're using
 * Once migration is complete, replace this function with:
 * return 'monarch.com';
 *
 * Single decision point for Monarch domain detection
 * @returns {string} The Monarch domain to use ('monarch.com' or 'monarchmoney.com')
 */
function getMonarchApiDomain() {
  const hostname = window.location.hostname;
  // During migration, detect which domain we're on
  if (hostname.includes('monarch.com') && !hostname.includes('monarchmoney.com')) {
    return 'monarch.com'; // New domain
  }
  return 'monarchmoney.com'; // Legacy domain (default)
}

// MIGRATION: Determine domain once at module load
const monarchDomain = getMonarchApiDomain();

// API Endpoints - dynamically constructed based on detected domain
export const API = {
  QUESTRADE_BASE_URL: 'https://api.questrade.com',
  MONARCH_GRAPHQL_URL: `https://api.${monarchDomain}/graphql`,
  MONARCH_TRANSACTIONS_UPLOAD_URL: `https://api.${monarchDomain}/statements/upload-async/`,
  MONARCH_BALANCE_UPLOAD_URL: `https://api.${monarchDomain}/account-balance-history/upload/`,
  MONARCH_APP_URL: `https://app.${monarchDomain}`,
};

// Storage keys
export const STORAGE = {
  ACCOUNTS_LIST: 'questrade_accounts_list',
  MONARCH_TOKEN: 'monarch_graphql_token',
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
  // Lookback period storage keys (days to look back from last upload date)
  QUESTRADE_LOOKBACK_DAYS: 'questrade_lookback_days',
  CANADALIFE_LOOKBACK_DAYS: 'canadalife_lookback_days',
  ROGERSBANK_LOOKBACK_DAYS: 'rogersbank_lookback_days',
};

// Brand colors
export const COLORS = {
  CANADALIFE_BRAND: '#A20A29',
  QUESTRADE_BRAND: '#0073b1',
  ROGERSBANK_BRAND: '#DA291C', // Rogers red
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
  COLORS,
  UI,
};
