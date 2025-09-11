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
};

// Brand colors
export const COLORS = {
  CANADALIFE_BRAND: '#A20A29',
  QUESTRADE_BRAND: '#0073b1',
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
