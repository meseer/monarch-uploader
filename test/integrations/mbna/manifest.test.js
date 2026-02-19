/**
 * Tests for MBNA Integration Manifest
 *
 * Validates that the manifest conforms to the IntegrationManifest contract
 * and aligns with the system-wide integration configuration.
 */

import manifest from '../../../src/integrations/mbna/manifest';
import { STORAGE } from '../../../src/core/config';
import { INTEGRATIONS, INTEGRATION_CAPABILITIES } from '../../../src/core/integrationCapabilities';

describe('MBNA Manifest', () => {
  describe('identity', () => {
    it('has a valid id matching INTEGRATIONS enum', () => {
      expect(manifest.id).toBe('mbna');
      expect(manifest.id).toBe(INTEGRATIONS.MBNA);
    });

    it('has a displayName', () => {
      expect(manifest.displayName).toBe('MBNA');
    });

    it('has a faviconDomain', () => {
      expect(manifest.faviconDomain).toBe('mbna.ca');
    });
  });

  describe('site matching', () => {
    it('matches service.mbna.ca domain', () => {
      expect(manifest.matchDomains).toContain('service.mbna.ca');
    });

    it('has matchUrls for the service domain', () => {
      expect(manifest.matchUrls).toContain('https://service.mbna.ca/*');
    });
  });

  describe('storage keys', () => {
    it('has accountsList matching STORAGE constant', () => {
      expect(manifest.storageKeys.accountsList).toBe('mbna_accounts_list');
      expect(manifest.storageKeys.accountsList).toBe(STORAGE.MBNA_ACCOUNTS_LIST);
    });

    it('has config matching STORAGE constant', () => {
      expect(manifest.storageKeys.config).toBe('mbna_config');
      expect(manifest.storageKeys.config).toBe(STORAGE.MBNA_CONFIG);
    });

    it('has cache set to null (no separate cache key)', () => {
      expect(manifest.storageKeys.cache).toBeNull();
    });
  });

  describe('configSchema', () => {
    it('defines auth fields', () => {
      expect(manifest.configSchema.auth).toEqual(
        expect.arrayContaining(['sessionActive', 'accountNumber', 'lastChecked']),
      );
    });

    it('defines settings fields', () => {
      expect(manifest.configSchema.settings).toEqual(
        expect.arrayContaining(['lookbackDays']),
      );
    });

    it('enables category mappings', () => {
      expect(manifest.configSchema.hasCategoryMappings).toBe(true);
    });

    it('disables holdings mappings (credit card only)', () => {
      expect(manifest.configSchema.hasHoldingsMappings).toBe(false);
    });
  });

  describe('capabilities', () => {
    it('supports transactions', () => {
      expect(manifest.capabilities.hasTransactions).toBe(true);
    });

    it('supports deduplication', () => {
      expect(manifest.capabilities.hasDeduplication).toBe(true);
    });

    it('supports balance history', () => {
      expect(manifest.capabilities.hasBalanceHistory).toBe(true);
    });

    it('supports credit limit sync', () => {
      expect(manifest.capabilities.hasCreditLimit).toBe(true);
    });

    it('supports balance reconstruction', () => {
      expect(manifest.capabilities.hasBalanceReconstruction).toBe(true);
    });

    it('supports categorization', () => {
      expect(manifest.capabilities.hasCategorization).toBe(true);
    });

    it('does NOT support holdings (credit card only)', () => {
      expect(manifest.capabilities.hasHoldings).toBe(false);
    });
  });

  describe('category config', () => {
    it('uses "Bank Category" as source label', () => {
      expect(manifest.categoryConfig.sourceLabel).toBe('Bank Category');
    });
  });

  describe('per-account settings', () => {
    it('has accountKeyName "mbnaAccount"', () => {
      expect(manifest.accountKeyName).toBe('mbnaAccount');
    });

    it('defines expected setting keys', () => {
      const keys = manifest.settings.map((s) => s.key);
      expect(keys).toEqual([
        'storeTransactionDetailsInNotes',
        'transactionRetentionDays',
        'transactionRetentionCount',
        'includePendingTransactions',
        'invertBalance',
        'skipCategorization',
      ]);
    });

    it('has sensible defaults', () => {
      const defaults = {};
      manifest.settings.forEach((s) => { defaults[s.key] = s.default; });

      expect(defaults.storeTransactionDetailsInNotes).toBe(false);
      expect(defaults.transactionRetentionDays).toBe(91);
      expect(defaults.transactionRetentionCount).toBe(1000);
      expect(defaults.includePendingTransactions).toBe(true);
      expect(defaults.invertBalance).toBe(false);
      expect(defaults.skipCategorization).toBe(false);
    });
  });

  describe('accountCreateDefaults', () => {
    it('has credit card defaults for account creation', () => {
      expect(manifest.accountCreateDefaults).toBeDefined();
      expect(manifest.accountCreateDefaults.defaultType).toBe('credit');
      expect(manifest.accountCreateDefaults.defaultSubtype).toBe('credit_card');
      expect(manifest.accountCreateDefaults.accountType).toBe('credit');
    });
  });

  describe('brand theming', () => {
    it('has a brandColor', () => {
      expect(manifest.brandColor).toBe('#003087');
    });

    it('has logoCloudinaryId for MBNA logo', () => {
      expect(manifest.logoCloudinaryId).toBe(
        'production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/uyjbhlklztevwjlpmj0n',
      );
    });
  });

  describe('alignment with INTEGRATION_CAPABILITIES', () => {
    const caps = INTEGRATION_CAPABILITIES[INTEGRATIONS.MBNA];

    it('capabilities entry exists in INTEGRATION_CAPABILITIES', () => {
      expect(caps).toBeDefined();
    });

    it('manifest id matches capabilities id', () => {
      expect(manifest.id).toBe(caps.id);
    });

    it('manifest displayName matches capabilities displayName', () => {
      expect(manifest.displayName).toBe(caps.displayName);
    });

    it('manifest accountKeyName matches capabilities accountKeyName', () => {
      expect(manifest.accountKeyName).toBe(caps.accountKeyName);
    });

    it('capability flags are consistent', () => {
      expect(manifest.capabilities.hasTransactions).toBe(caps.hasTransactions);
      expect(manifest.capabilities.hasDeduplication).toBe(caps.hasDeduplication);
      expect(manifest.capabilities.hasBalanceHistory).toBe(caps.hasBalanceHistory);
      expect(manifest.capabilities.hasCreditLimit).toBe(caps.hasCreditLimit);
      expect(manifest.capabilities.hasHoldings).toBe(caps.hasHoldings);
      expect(manifest.capabilities.hasBalanceReconstruction).toBe(caps.hasBalanceReconstruction);
      expect(manifest.capabilities.hasCategorization).toBe(caps.hasCategorization);
    });

    it('configStorageKey matches manifest storageKeys.config', () => {
      expect(caps.configStorageKey).toBe(manifest.storageKeys.config);
    });
  });
});