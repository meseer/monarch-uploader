import type { IntegrationManifest } from '../types';

const manifest: IntegrationManifest = {
  id: 'neo',
  displayName: 'Neo Financial',
  faviconDomain: 'neofinancial.com',
  matchDomains: ['member.neofinancial.com'],
  matchUrls: ['https://member.neofinancial.com/*'],
  storageKeys: {
    accountsList: 'neo_accounts_list',
    config: 'neo_config',
    cache: null,
  },
  defaultLookbackDays: 91,
  configSchema: {
    auth: ['sessionActive', 'lastChecked'],
    settings: [
      'storeTransactionDetailsInNotes',
      'transactionRetentionDays',
      'transactionRetentionCount',
    ],
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
  accountKeyName: 'neoAccount',
  settings: [
    { key: 'storeTransactionDetailsInNotes', default: false },
    { key: 'transactionRetentionDays', default: 91 },
    { key: 'transactionRetentionCount', default: 1000 },
  ],
  accountDefaultsForAccount(account) {
    if (account.accountType === 'credit') {
      return {
        accountCreateDefaults: {
          defaultType: 'credit',
          defaultSubtype: 'credit_card',
          accountType: 'credit',
        },
        settings: { invertBalance: false },
      };
    }

    if (account.accountType === 'depository' && account.category === 'EVERYDAY') {
      return {
        accountCreateDefaults: {
          defaultType: 'depository',
          defaultSubtype: 'checking',
          accountType: 'depository',
        },
        settings: { invertBalance: true },
      };
    }

    if (account.accountType === 'depository' && account.category === 'HISA') {
      return {
        accountCreateDefaults: {
          defaultType: 'depository',
          defaultSubtype: 'savings',
          accountType: 'depository',
        },
        settings: { invertBalance: true },
      };
    }

    throw new Error(`Unsupported Neo account: ${String(account.accountType)} ${String(account.category)}`);
  },
  brandColor: '#00AEEF',
  logoCloudinaryId: null,
  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};

export default manifest;
