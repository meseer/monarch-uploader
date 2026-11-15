import manifest from '../../../src/integrations/pcfinancial/manifest';
import injectionPoint from '../../../src/integrations/pcfinancial/source/injectionPoint';

describe('PC Financial manifest', () => {
  it('matches secure.pcfinancial.ca and declares transaction, balance, and credit limit capabilities', () => {
    expect(manifest.id).toBe('pcfinancial');
    expect(manifest.displayName).toBe('PC Financial');
    expect(manifest.matchDomains).toEqual(['secure.pcfinancial.ca']);
    expect(manifest.matchUrls).toEqual(['https://secure.pcfinancial.ca/*']);
    expect(manifest.accountKeyName).toBe('pcfinancialAccount');
    expect(manifest.logoCloudinaryId).toBe('production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/ohixis5wh4txefkq0amd');
    expect(manifest.capabilities).toEqual({
      hasTransactions: true,
      hasDeduplication: true,
      hasBalanceHistory: true,
      hasCreditLimit: true,
      hasHoldings: false,
      hasBalanceReconstruction: false,
      hasCategorization: false,
    });
  });

  it('declares settings without dead includePendingTransactions toggle', () => {
    const settingKeys = manifest.settings.map((s) => s.key);
    expect(settingKeys).toEqual([
      'storeTransactionDetailsInNotes',
      'transactionRetentionDays',
      'transactionRetentionCount',
      'invertBalance',
    ]);
    expect(settingKeys).not.toContain('includePendingTransactions');
  });

  it('uses credit-card defaults and liability sign for credit accounts', () => {
    expect(manifest.accountDefaultsForAccount({ accountType: 'credit', productType: 'CREDIT-CARD' })).toEqual({
      accountCreateDefaults: {
        defaultType: 'credit',
        defaultSubtype: 'credit_card',
        accountType: 'credit',
      },
      settings: { invertBalance: false },
    });
  });

  it('uses checking defaults and asset sign for depository / PC Money accounts', () => {
    expect(manifest.accountDefaultsForAccount({ accountType: 'depository', productType: 'PC-MONEY' })).toEqual({
      accountCreateDefaults: {
        defaultType: 'depository',
        defaultSubtype: 'checking',
        accountType: 'depository',
      },
      settings: { invertBalance: true },
    });
  });

  it('defines a quick-actions-container insertAfter injection point and skips authentication routes', () => {
    expect(injectionPoint.containerId).toBe('monarch-uploader-pcfinancial');
    expect(injectionPoint.isSPA).toBe(true);
    expect(injectionPoint.selectors).toEqual([{ selector: 'div.quick-actions-container', insertMethod: 'insertAfter' }]);
    expect(injectionPoint.pageModes[0].selectors).toEqual([{ selector: 'div.quick-actions-container', insertMethod: 'insertAfter' }]);
    expect(injectionPoint.containerStyle).toEqual({
      background: '#e0d9ff',
      border: '2px solid rgba(198, 185, 255, 0.2)',
      borderRadius: '12px',
      boxShadow: 'none',
      padding: '12px',
    });
    expect(manifest.brandColor).toBe('#333333');
    expect(injectionPoint.skipPatterns.some((pattern) => pattern.test('/login'))).toBe(true);
    expect(injectionPoint.skipPatterns.some((pattern) => pattern.test('/sign-in'))).toBe(true);
  });
});
