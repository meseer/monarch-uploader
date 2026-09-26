import manifest from '../../../src/integrations/neo/manifest';
import injectionPoint from '../../../src/integrations/neo/source/injectionPoint';

describe('Neo manifest', () => {
  it('matches the member portal and declares transaction and balance capabilities', () => {
    expect(manifest.id).toBe('neo');
    expect(manifest.matchDomains).toContain('member.neofinancial.com');
    expect(manifest.matchUrls).toContain('https://member.neofinancial.com/*');
    expect(manifest.capabilities).toMatchObject({
      hasTransactions: true,
      hasDeduplication: true,
      hasBalanceHistory: true,
      hasCreditLimit: true,
      hasBalanceReconstruction: false,
      hasHoldings: false,
    });
  });

  it('uses credit-card defaults and liability sign for credit accounts', () => {
    expect(manifest.accountDefaultsForAccount({ accountType: 'credit' })).toEqual({
      accountCreateDefaults: { defaultType: 'credit', defaultSubtype: 'credit_card', accountType: 'credit' },
      settings: { invertBalance: false },
    });
  });

  it('uses checking defaults and asset sign for Everyday accounts', () => {
    expect(manifest.accountDefaultsForAccount({ accountType: 'depository', category: 'EVERYDAY' })).toEqual({
      accountCreateDefaults: { defaultType: 'depository', defaultSubtype: 'checking', accountType: 'depository' },
      settings: { invertBalance: true },
    });
  });

  it('uses savings defaults and asset sign for HISA accounts', () => {
    expect(manifest.accountDefaultsForAccount({ accountType: 'depository', category: 'HISA' })).toEqual({
      accountCreateDefaults: { defaultType: 'depository', defaultSubtype: 'savings', accountType: 'depository' },
      settings: { invertBalance: true },
    });
  });

  it('keeps balance direction tied to the account type', () => {
    expect(manifest.configSchema.settings).not.toContain('invertBalance');
    expect(manifest.settings.map(({ key }) => key)).not.toContain('invertBalance');
  });

  it('injects into account pages and skips the login route', () => {
    expect(injectionPoint.isSPA).toBe(true);
    expect(injectionPoint.appPagePatterns.some((pattern) => pattern.test('https://member.neofinancial.com/en-CA/accounts'))).toBe(true);
    expect(injectionPoint.skipPatterns.some((pattern) => pattern.test('https://member.neofinancial.com/login'))).toBe(true);
    expect(injectionPoint.pageModes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'accounts', uiType: 'all-accounts' }),
      expect.objectContaining({ id: 'account', uiType: 'all-accounts' }),
    ]));
    expect(injectionPoint.pageModes[0].selectors).toEqual([
      { selector: '.MuiContainer-root.MuiContainer-maxWidthXl', insertMethod: 'prepend' },
    ]);
  });

  it('targets the content container used by the Neo account pages', () => {
    document.body.innerHTML = '<div class="MuiContainer-root MuiContainer-maxWidthXl"></div>';

    for (const pageMode of injectionPoint.pageModes) {
      expect(document.querySelector(pageMode.selectors[0].selector)).not.toBeNull();
    }
  });
});
