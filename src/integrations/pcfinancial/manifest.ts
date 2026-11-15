import type { IntegrationManifest } from '../types';

const manifest: IntegrationManifest = {
  id: 'pcfinancial',
  displayName: 'PC Financial',
  faviconDomain: 'pcfinancial.ca',
  matchDomains: ['secure.pcfinancial.ca'],
  matchUrls: ['https://secure.pcfinancial.ca/*'],
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
    hasBalanceHistory: true,
    hasCreditLimit: true,
    hasHoldings: false,
    hasBalanceReconstruction: false,
    hasCategorization: false,
  },
  categoryConfig: null,
  accountKeyName: 'pcfinancialAccount',
  settings: [
    { key: 'storeTransactionDetailsInNotes', default: false },
    { key: 'transactionRetentionDays', default: 91 },
    { key: 'transactionRetentionCount', default: 1000 },
    { key: 'invertBalance', default: false },
  ],
  accountCreateDefaults: {
    defaultType: 'credit',
    defaultSubtype: 'credit_card',
    accountType: 'credit',
  },
  accountDefaultsForAccount(account) {
    if (account.accountType === 'depository' || account.productType === 'PC-MONEY') {
      return {
        accountCreateDefaults: {
          defaultType: 'depository',
          defaultSubtype: 'checking',
          accountType: 'depository',
        },
        settings: { invertBalance: true },
      };
    }

    return {
      accountCreateDefaults: {
        defaultType: 'credit',
        defaultSubtype: 'credit_card',
        accountType: 'credit',
      },
      settings: { invertBalance: false },
    };
  },
  brandColor: '#333333',
  logoCloudinaryId: 'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/ohixis5wh4txefkq0amd',
  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};

export default manifest;
