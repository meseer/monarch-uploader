import type { IntegrationManifest } from '../types';
import { getDepositProductInfo } from './source/api';

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

    // Unknown deposit accounts never reach mapping (getAccounts skips them),
    // so this falls back to safe savings defaults instead of throwing and
    // aborting the sync for every account after it.
    const productInfo = getDepositProductInfo(String(account.productName ?? ''));
    const subtype = productInfo?.accountSubtype
      ?? (account.category === 'EVERYDAY' ? 'checking' : 'savings');
    return {
      accountCreateDefaults: {
        defaultType: 'depository',
        defaultSubtype: subtype,
        accountType: 'depository',
      },
      settings: { invertBalance: true },
    };
  },
  brandColor: '#00AEEF',
  logoCloudinaryId: null,
  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};

export default manifest;
