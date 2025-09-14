/**
 * Configuration constants for the Questrade to Monarch balance uploader
 * This file will gradually replace inline constants in the original script
 */

// Debug settings
export const DEBUG_LOG = true;

// API Endpoints
export const API = {
  QUESTRADE_BASE_URL: 'https://api.questrade.com',
  MONARCH_GRAPHQL_URL: 'https://api.monarchmoney.com/graphql',
  MONARCH_TRANSACTIONS_UPLOAD_URL: 'https://api.monarchmoney.com/statements/upload-async/',
};

// Storage keys
export const STORAGE = {
  ACCOUNTS_LIST: 'questrade_accounts_list',
  MONARCH_TOKEN: 'monarch_graphql_token',
  ACCOUNT_MAPPING_PREFIX: 'monarch_account_for_',
  LAST_DATE_PREFIX: 'lastUsedFromDate_',
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
