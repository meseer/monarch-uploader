/**
 * Tests for Integration Capabilities Configuration
 */

import {
  INTEGRATIONS,
  ACCOUNT_SETTINGS,
  INTEGRATION_CAPABILITIES,
  getCapabilities,
  hasCapability,
  hasSetting,
  getSettingDefault,
  getDefaultSettings,
  getAccountKeyName,
  getIntegrationsWithCapability,
  getIntegrationsWithSetting,
  getDisplayName,
} from '../../src/core/integrationCapabilities';
import { TRANSACTION_RETENTION_DEFAULTS } from '../../src/core/config';

describe('Integration Capabilities', () => {
  describe('INTEGRATIONS constants', () => {
    test('should define all integration identifiers', () => {
      expect(INTEGRATIONS.WEALTHSIMPLE).toBe('wealthsimple');
      expect(INTEGRATIONS.QUESTRADE).toBe('questrade');
      expect(INTEGRATIONS.CANADALIFE).toBe('canadalife');
      expect(INTEGRATIONS.ROGERSBANK).toBe('rogersbank');
    });

    test('should have unique values', () => {
      const values = Object.values(INTEGRATIONS);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });

  describe('ACCOUNT_SETTINGS constants', () => {
    test('should define all setting keys', () => {
      expect(ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES).toBe('storeTransactionDetailsInNotes');
      expect(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS).toBe('transactionRetentionDays');
      expect(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT).toBe('transactionRetentionCount');
      expect(ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS).toBe('stripStoreNumbers');
      expect(ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS).toBe('includePendingTransactions');
    });
  });

  describe('INTEGRATION_CAPABILITIES', () => {
    test('should define capabilities for all integrations', () => {
      expect(INTEGRATION_CAPABILITIES[INTEGRATIONS.WEALTHSIMPLE]).toBeDefined();
      expect(INTEGRATION_CAPABILITIES[INTEGRATIONS.QUESTRADE]).toBeDefined();
      expect(INTEGRATION_CAPABILITIES[INTEGRATIONS.CANADALIFE]).toBeDefined();
      expect(INTEGRATION_CAPABILITIES[INTEGRATIONS.ROGERSBANK]).toBeDefined();
    });

    describe('Wealthsimple capabilities', () => {
      const ws = INTEGRATION_CAPABILITIES[INTEGRATIONS.WEALTHSIMPLE];

      test('should have correct display name and account key', () => {
        expect(ws.displayName).toBe('Wealthsimple');
        expect(ws.accountKeyName).toBe('wealthsimpleAccount');
      });

      test('should support all features', () => {
        expect(ws.hasTransactions).toBe(true);
        expect(ws.hasDeduplication).toBe(true);
        expect(ws.hasBalanceHistory).toBe(true);
        expect(ws.hasCreditLimit).toBe(true);
        expect(ws.hasHoldings).toBe(true);
        expect(ws.hasBalanceReconstruction).toBe(true);
      });

      test('should have all settings', () => {
        expect(ws.settings).toContain(ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES);
        expect(ws.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS);
        expect(ws.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT);
        expect(ws.settings).toContain(ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS);
        expect(ws.settings).toContain(ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS);
      });

      test('should have correct default values', () => {
        expect(ws.settingDefaults[ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES]).toBe(false);
        expect(ws.settingDefaults[ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS]).toBe(TRANSACTION_RETENTION_DEFAULTS.DAYS);
        expect(ws.settingDefaults[ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT]).toBe(TRANSACTION_RETENTION_DEFAULTS.COUNT);
        expect(ws.settingDefaults[ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS]).toBe(true);
        expect(ws.settingDefaults[ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS]).toBe(true);
      });
    });

    describe('Questrade capabilities', () => {
      const qt = INTEGRATION_CAPABILITIES[INTEGRATIONS.QUESTRADE];

      test('should have correct display name and account key', () => {
        expect(qt.displayName).toBe('Questrade');
        expect(qt.accountKeyName).toBe('questradeAccount');
      });

      test('should support investment features', () => {
        expect(qt.hasTransactions).toBe(true);
        expect(qt.hasDeduplication).toBe(true);
        expect(qt.hasBalanceHistory).toBe(true);
        expect(qt.hasHoldings).toBe(true);
      });

      test('should not support credit card features', () => {
        expect(qt.hasCreditLimit).toBe(false);
        expect(qt.hasBalanceReconstruction).toBe(false);
      });

      test('should have transaction settings but not Wealthsimple-specific ones', () => {
        expect(qt.settings).toContain(ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES);
        expect(qt.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS);
        expect(qt.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT);
        expect(qt.settings).not.toContain(ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS);
        expect(qt.settings).not.toContain(ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS);
      });
    });

    describe('CanadaLife capabilities', () => {
      const cl = INTEGRATION_CAPABILITIES[INTEGRATIONS.CANADALIFE];

      test('should have correct display name and account key', () => {
        expect(cl.displayName).toBe('Canada Life');
        expect(cl.accountKeyName).toBe('canadalifAccount');
      });

      test('should support balance history and transactions', () => {
        expect(cl.hasBalanceHistory).toBe(true);
        expect(cl.hasTransactions).toBe(true);
        expect(cl.hasDeduplication).toBe(true);
      });

      test('should not support credit card or holdings features', () => {
        expect(cl.hasCreditLimit).toBe(false);
        expect(cl.hasHoldings).toBe(false);
        expect(cl.hasBalanceReconstruction).toBe(false);
      });

      test('should have transaction retention settings', () => {
        expect(cl.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS);
        expect(cl.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT);
        expect(cl.settings).not.toContain(ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS);
        expect(cl.settings).not.toContain(ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS);
      });
    });

    describe('Rogers Bank capabilities', () => {
      const rb = INTEGRATION_CAPABILITIES[INTEGRATIONS.ROGERSBANK];

      test('should have correct display name and account key', () => {
        expect(rb.displayName).toBe('Rogers Bank');
        expect(rb.accountKeyName).toBe('rogersbankAccount');
      });

      test('should support credit card features', () => {
        expect(rb.hasTransactions).toBe(true);
        expect(rb.hasDeduplication).toBe(true);
        expect(rb.hasBalanceHistory).toBe(true);
        expect(rb.hasCreditLimit).toBe(true);
        expect(rb.hasBalanceReconstruction).toBe(true);
      });

      test('should not support holdings (credit card only)', () => {
        expect(rb.hasHoldings).toBe(false);
      });

      test('should have transaction settings but not Wealthsimple-specific ones', () => {
        expect(rb.settings).toContain(ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES);
        expect(rb.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS);
        expect(rb.settings).toContain(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT);
        expect(rb.settings).not.toContain(ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS);
        expect(rb.settings).not.toContain(ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS);
      });
    });
  });

  describe('getCapabilities', () => {
    test('should return capabilities for valid integration', () => {
      const ws = getCapabilities(INTEGRATIONS.WEALTHSIMPLE);
      expect(ws).toBeDefined();
      expect(ws.id).toBe(INTEGRATIONS.WEALTHSIMPLE);
    });

    test('should return null for invalid integration', () => {
      expect(getCapabilities('invalid')).toBeNull();
      expect(getCapabilities('')).toBeNull();
      expect(getCapabilities(null)).toBeNull();
      expect(getCapabilities(undefined)).toBeNull();
    });
  });

  describe('hasCapability', () => {
    test('should return true for supported capabilities', () => {
      expect(hasCapability(INTEGRATIONS.WEALTHSIMPLE, 'hasTransactions')).toBe(true);
      expect(hasCapability(INTEGRATIONS.WEALTHSIMPLE, 'hasDeduplication')).toBe(true);
      expect(hasCapability(INTEGRATIONS.ROGERSBANK, 'hasCreditLimit')).toBe(true);
    });

    test('should return false for unsupported capabilities', () => {
      expect(hasCapability(INTEGRATIONS.CANADALIFE, 'hasCreditLimit')).toBe(false);
      expect(hasCapability(INTEGRATIONS.QUESTRADE, 'hasCreditLimit')).toBe(false);
      expect(hasCapability(INTEGRATIONS.ROGERSBANK, 'hasHoldings')).toBe(false);
    });

    test('should return false for invalid integration', () => {
      expect(hasCapability('invalid', 'hasTransactions')).toBe(false);
    });

    test('should return false for non-existent capability', () => {
      expect(hasCapability(INTEGRATIONS.WEALTHSIMPLE, 'hasNonExistent')).toBe(false);
    });
  });

  describe('hasSetting', () => {
    test('should return true for supported settings', () => {
      expect(hasSetting(INTEGRATIONS.WEALTHSIMPLE, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)).toBe(true);
      expect(hasSetting(INTEGRATIONS.WEALTHSIMPLE, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS)).toBe(true);
      expect(hasSetting(INTEGRATIONS.QUESTRADE, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS)).toBe(true);
    });

    test('should return false for unsupported settings', () => {
      expect(hasSetting(INTEGRATIONS.CANADALIFE, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)).toBe(false);
      expect(hasSetting(INTEGRATIONS.QUESTRADE, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS)).toBe(false);
    });

    test('should return false for invalid integration', () => {
      expect(hasSetting('invalid', ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)).toBe(false);
    });
  });

  describe('getSettingDefault', () => {
    test('should return correct default values', () => {
      expect(getSettingDefault(INTEGRATIONS.WEALTHSIMPLE, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)).toBe(false);
      expect(getSettingDefault(INTEGRATIONS.WEALTHSIMPLE, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS)).toBe(true);
      expect(getSettingDefault(INTEGRATIONS.WEALTHSIMPLE, ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS)).toBe(true);
      expect(getSettingDefault(INTEGRATIONS.QUESTRADE, ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS)).toBe(TRANSACTION_RETENTION_DEFAULTS.DAYS);
    });

    test('should return undefined for unsupported settings', () => {
      expect(getSettingDefault(INTEGRATIONS.CANADALIFE, ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)).toBeUndefined();
      expect(getSettingDefault(INTEGRATIONS.QUESTRADE, ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS)).toBeUndefined();
    });

    test('should return undefined for invalid integration', () => {
      expect(getSettingDefault('invalid', ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES)).toBeUndefined();
    });
  });

  describe('getDefaultSettings', () => {
    test('should return all defaults for Wealthsimple', () => {
      const defaults = getDefaultSettings(INTEGRATIONS.WEALTHSIMPLE);
      expect(defaults[ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES]).toBe(false);
      expect(defaults[ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS]).toBe(true);
      expect(defaults[ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS]).toBe(true);
    });

    test('should return transaction retention defaults for CanadaLife', () => {
      const defaults = getDefaultSettings(INTEGRATIONS.CANADALIFE);
      expect(defaults[ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS]).toBe(TRANSACTION_RETENTION_DEFAULTS.DAYS);
      expect(defaults[ACCOUNT_SETTINGS.TRANSACTION_RETENTION_COUNT]).toBe(TRANSACTION_RETENTION_DEFAULTS.COUNT);
      // Should NOT have Wealthsimple-specific settings
      expect(defaults[ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS]).toBeUndefined();
      expect(defaults[ACCOUNT_SETTINGS.INCLUDE_PENDING_TRANSACTIONS]).toBeUndefined();
    });

    test('should return empty object for invalid integration', () => {
      expect(getDefaultSettings('invalid')).toEqual({});
    });
  });

  describe('getAccountKeyName', () => {
    test('should return correct key names', () => {
      expect(getAccountKeyName(INTEGRATIONS.WEALTHSIMPLE)).toBe('wealthsimpleAccount');
      expect(getAccountKeyName(INTEGRATIONS.QUESTRADE)).toBe('questradeAccount');
      expect(getAccountKeyName(INTEGRATIONS.CANADALIFE)).toBe('canadalifAccount');
      expect(getAccountKeyName(INTEGRATIONS.ROGERSBANK)).toBe('rogersbankAccount');
    });

    test('should return null for invalid integration', () => {
      expect(getAccountKeyName('invalid')).toBeNull();
    });
  });

  describe('getIntegrationsWithCapability', () => {
    test('should return integrations with transactions', () => {
      const result = getIntegrationsWithCapability('hasTransactions');
      expect(result).toContain(INTEGRATIONS.WEALTHSIMPLE);
      expect(result).toContain(INTEGRATIONS.QUESTRADE);
      expect(result).toContain(INTEGRATIONS.ROGERSBANK);
      expect(result).toContain(INTEGRATIONS.CANADALIFE);
    });

    test('should return integrations with credit limit', () => {
      const result = getIntegrationsWithCapability('hasCreditLimit');
      expect(result).toContain(INTEGRATIONS.WEALTHSIMPLE);
      expect(result).toContain(INTEGRATIONS.ROGERSBANK);
      expect(result).not.toContain(INTEGRATIONS.QUESTRADE);
      expect(result).not.toContain(INTEGRATIONS.CANADALIFE);
    });

    test('should return all integrations with balance history', () => {
      const result = getIntegrationsWithCapability('hasBalanceHistory');
      expect(result).toHaveLength(4);
      expect(result).toContain(INTEGRATIONS.WEALTHSIMPLE);
      expect(result).toContain(INTEGRATIONS.QUESTRADE);
      expect(result).toContain(INTEGRATIONS.CANADALIFE);
      expect(result).toContain(INTEGRATIONS.ROGERSBANK);
    });

    test('should return empty array for non-existent capability', () => {
      expect(getIntegrationsWithCapability('hasNonExistent')).toEqual([]);
    });
  });

  describe('getIntegrationsWithSetting', () => {
    test('should return integrations with transaction retention settings', () => {
      const result = getIntegrationsWithSetting(ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS);
      expect(result).toContain(INTEGRATIONS.WEALTHSIMPLE);
      expect(result).toContain(INTEGRATIONS.QUESTRADE);
      expect(result).toContain(INTEGRATIONS.ROGERSBANK);
      expect(result).toContain(INTEGRATIONS.CANADALIFE);
    });

    test('should return only Wealthsimple for strip store numbers', () => {
      const result = getIntegrationsWithSetting(ACCOUNT_SETTINGS.STRIP_STORE_NUMBERS);
      expect(result).toEqual([INTEGRATIONS.WEALTHSIMPLE]);
    });

    test('should return empty array for non-existent setting', () => {
      expect(getIntegrationsWithSetting('nonExistentSetting')).toEqual([]);
    });
  });

  describe('getDisplayName', () => {
    test('should return correct display names', () => {
      expect(getDisplayName(INTEGRATIONS.WEALTHSIMPLE)).toBe('Wealthsimple');
      expect(getDisplayName(INTEGRATIONS.QUESTRADE)).toBe('Questrade');
      expect(getDisplayName(INTEGRATIONS.CANADALIFE)).toBe('Canada Life');
      expect(getDisplayName(INTEGRATIONS.ROGERSBANK)).toBe('Rogers Bank');
    });

    test('should return the ID for invalid integration', () => {
      expect(getDisplayName('invalid')).toBe('invalid');
      expect(getDisplayName('custom_integration')).toBe('custom_integration');
    });
  });
});
