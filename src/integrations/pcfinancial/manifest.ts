import type { IntegrationManifest } from '../types';

const manifest: IntegrationManifest = {
  id: 'pcfinancial',
  displayName: 'PC Financial',
  faviconDomain: 'pcfinancial.ca',
  matchDomains: ['secure.pcfinancial.ca', 'app.pcfinancial.ca'],
  matchUrls: ['https://secure.pcfinancial.ca/*', 'https://app.pcfinancial.ca/*'],
  storageKeys: {
    accountsList: 'pcfinancial_accounts_list',
    config: 'pcfinancial_config',
    cache: null,
  },
  defaultLookbackDays: 7,
  configSchema: {
    auth: [],
    settings: ['lookbackDays'],
    hasCategoryMappings: false,
    hasHoldingsMappings: false,
  },
  capabilities: {
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: false,
    hasCreditLimit: false,
    hasHoldings: false,
    hasBalanceReconstruction: false,
    hasCategorization: false,
  },
  categoryConfig: null,
  accountKeyName: 'pcfinancialAccount',
  settings: [
    { key: 'transactionRetentionDays', default: 91 },
    { key: 'transactionRetentionCount', default: 1000 },
    { key: 'includePendingTransactions', default: false },
  ],
  accountCreateDefaults: {
    defaultType: 'depository',
    defaultSubtype: 'checking',
    accountType: 'depository',
  },
  brandColor: '#F2B900',
  logoCloudinaryId: null,
  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};

export default manifest;
