/**
 * Tests for Unified Account Service
 */

import {
  getStorageKey,
  getAccounts,
  getAccountData,
  saveAccounts,
  updateAccountInList,
  upsertAccount,
  removeAccount,
  markAccountAsSkipped,
  isAccountSkipped,
  getAccountSetting,
  setAccountSetting,
  hasLegacyData,
  migrateFromLegacyStorage,
  getMigrationStatus,
  clearAllAccounts,
} from '../../../src/services/common/accountService';
import { INTEGRATIONS, ACCOUNT_SETTINGS } from '../../../src/core/integrationCapabilities';
import { STORAGE, TRANSACTION_RETENTION_DEFAULTS } from '../../../src/core/config';

describe('Account Service', () => {
  // Create local storage simulation for GM functions
  let gmStorage = {};

  beforeEach(() => {
    // Reset storage
    gmStorage = {};

    // Mock GM_getValue to read from our storage
    global.GM_getValue = jest.fn(
      (key, defaultValue) => (gmStorage[key] !== undefined ? gmStorage[key] : defaultValue),
    );

    // Mock GM_setValue to write to our storage
    global.GM_setValue = jest.fn((key, value) => {
      gmStorage[key] = value;
    });

    // Mock GM_deleteValue to delete from our storage
    global.GM_deleteValue = jest.fn((key) => {
      delete gmStorage[key];
    });

    // Mock GM_listValues to return keys from our storage (synchronous array)
    global.GM_listValues = jest.fn(() => Object.keys(gmStorage));
  });

  describe('getStorageKey', () => {
    test('should return correct storage key for Wealthsimple', () => {
      expect(getStorageKey(INTEGRATIONS.WEALTHSIMPLE)).toBe(STORAGE.WEALTHSIMPLE_ACCOUNTS_LIST);
    });

    test('should return correct storage key for Questrade', () => {
      expect(getStorageKey(INTEGRATIONS.QUESTRADE)).toBe(STORAGE.ACCOUNTS_LIST);
    });

    test('should return correct storage key for CanadaLife', () => {
      expect(getStorageKey(INTEGRATIONS.CANADALIFE)).toBe(STORAGE.CANADALIFE_ACCOUNTS_LIST);
    });

    test('should return correct storage key for Rogers Bank', () => {
      expect(getStorageKey(INTEGRATIONS.ROGERSBANK)).toBe(STORAGE.ROGERSBANK_ACCOUNTS_LIST);
    });

    test('should return null for unknown integration', () => {
      expect(getStorageKey('unknown')).toBeNull();
    });
  });

  describe('getAccounts', () => {
    test('should return empty array for new integration', () => {
      const accounts = getAccounts(INTEGRATIONS.CANADALIFE);
      expect(accounts).toEqual([]);
    });

    test('should return stored accounts', () => {
      const testAccounts = [
        {
          canadalifAccount: { id: 'acc-1', nickname: 'RRSP' },
          monarchAccount: { id: 'monarch-1', displayName: 'CL RRSP' },
          syncEnabled: true,
        },
      ];
      GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, JSON.stringify(testAccounts));

      const accounts = getAccounts(INTEGRATIONS.CANADALIFE);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].canadalifAccount.id).toBe('acc-1');
    });

    test('should return empty array for invalid JSON', () => {
      GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, 'invalid json');
      const accounts = getAccounts(INTEGRATIONS.CANADALIFE);
      expect(accounts).toEqual([]);
    });

    test('should return empty array for unknown integration', () => {
      const accounts = getAccounts('unknown');
      expect(accounts).toEqual([]);
    });
  });

  describe('getAccountData', () => {
    beforeEach(() => {
      const testAccounts = [
        {
          canadalifAccount: { id: 'acc-1', nickname: 'RRSP' },
          monarchAccount: { id: 'monarch-1' },
          syncEnabled: true,
        },
        {
          canadalifAccount: { id: 'acc-2', nickname: 'TFSA' },
          monarchAccount: { id: 'monarch-2' },
          syncEnabled: false,
        },
      ];
      GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, JSON.stringify(testAccounts));
    });

    test('should return account data by ID', () => {
      const account = getAccountData(INTEGRATIONS.CANADALIFE, 'acc-1');
      expect(account).not.toBeNull();
      expect(account.canadalifAccount.nickname).toBe('RRSP');
    });

    test('should return null for non-existent account', () => {
      const account = getAccountData(INTEGRATIONS.CANADALIFE, 'non-existent');
      expect(account).toBeNull();
    });

    test('should return null for unknown integration', () => {
      const account = getAccountData('unknown', 'acc-1');
      expect(account).toBeNull();
    });
  });

  describe('saveAccounts', () => {
    test('should save accounts to storage', () => {
      const testAccounts = [
        {
          canadalifAccount: { id: 'acc-1' },
          monarchAccount: { id: 'monarch-1' },
        },
      ];

      const result = saveAccounts(INTEGRATIONS.CANADALIFE, testAccounts);
      expect(result).toBe(true);

      const stored = JSON.parse(GM_getValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, '[]'));
      expect(stored).toHaveLength(1);
    });

    test('should return false for unknown integration', () => {
      const result = saveAccounts('unknown', []);
      expect(result).toBe(false);
    });
  });

  describe('updateAccountInList', () => {
    beforeEach(() => {
      const testAccounts = [
        {
          canadalifAccount: { id: 'acc-1', nickname: 'RRSP' },
          monarchAccount: { id: 'monarch-1' },
          syncEnabled: true,
          lastSyncDate: null,
        },
      ];
      GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, JSON.stringify(testAccounts));
    });

    test('should update account properties', () => {
      const result = updateAccountInList(INTEGRATIONS.CANADALIFE, 'acc-1', {
        lastSyncDate: '2024-01-15',
        syncEnabled: false,
      });

      expect(result).toBe(true);

      const account = getAccountData(INTEGRATIONS.CANADALIFE, 'acc-1');
      expect(account.lastSyncDate).toBe('2024-01-15');
      expect(account.syncEnabled).toBe(false);
      // Original data should be preserved
      expect(account.canadalifAccount.nickname).toBe('RRSP');
    });

    test('should return false for non-existent account', () => {
      const result = updateAccountInList(INTEGRATIONS.CANADALIFE, 'non-existent', {
        lastSyncDate: '2024-01-15',
      });
      expect(result).toBe(false);
    });
  });

  describe('upsertAccount', () => {
    test('should add new account with defaults', () => {
      const result = upsertAccount(INTEGRATIONS.QUESTRADE, {
        questradeAccount: { id: 'qt-1', nickname: 'TFSA' },
        monarchAccount: { id: 'monarch-1' },
      });

      expect(result).toBe(true);

      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].syncEnabled).toBe(true);
      expect(accounts[0].transactionRetentionDays).toBe(TRANSACTION_RETENTION_DEFAULTS.DAYS);
    });

    test('should update existing account', () => {
      // First add
      upsertAccount(INTEGRATIONS.QUESTRADE, {
        questradeAccount: { id: 'qt-1', nickname: 'TFSA' },
        monarchAccount: { id: 'monarch-1' },
      });

      // Then update
      const result = upsertAccount(INTEGRATIONS.QUESTRADE, {
        questradeAccount: { id: 'qt-1', nickname: 'Updated TFSA' },
        monarchAccount: { id: 'monarch-2' },
        lastSyncDate: '2024-01-20',
      });

      expect(result).toBe(true);

      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].questradeAccount.nickname).toBe('Updated TFSA');
      expect(accounts[0].monarchAccount.id).toBe('monarch-2');
    });

    test('should return false for missing account ID', () => {
      const result = upsertAccount(INTEGRATIONS.QUESTRADE, {
        questradeAccount: {},
        monarchAccount: { id: 'monarch-1' },
      });
      expect(result).toBe(false);
    });
  });

  describe('removeAccount', () => {
    beforeEach(() => {
      const testAccounts = [
        { rogersbankAccount: { id: 'rb-1' }, monarchAccount: { id: 'm-1' } },
        { rogersbankAccount: { id: 'rb-2' }, monarchAccount: { id: 'm-2' } },
      ];
      GM_setValue(STORAGE.ROGERSBANK_ACCOUNTS_LIST, JSON.stringify(testAccounts));
    });

    test('should remove account by ID', () => {
      const result = removeAccount(INTEGRATIONS.ROGERSBANK, 'rb-1');
      expect(result).toBe(true);

      const accounts = getAccounts(INTEGRATIONS.ROGERSBANK);
      expect(accounts).toHaveLength(1);
      expect(accounts[0].rogersbankAccount.id).toBe('rb-2');
    });

    test('should return false for non-existent account', () => {
      const result = removeAccount(INTEGRATIONS.ROGERSBANK, 'non-existent');
      expect(result).toBe(false);
    });
  });

  describe('markAccountAsSkipped / isAccountSkipped', () => {
    beforeEach(() => {
      const testAccounts = [
        {
          canadalifAccount: { id: 'acc-1' },
          monarchAccount: { id: 'monarch-1' },
          syncEnabled: true,
        },
      ];
      GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, JSON.stringify(testAccounts));
    });

    test('should mark account as skipped', () => {
      expect(isAccountSkipped(INTEGRATIONS.CANADALIFE, 'acc-1')).toBe(false);

      markAccountAsSkipped(INTEGRATIONS.CANADALIFE, 'acc-1', true);

      expect(isAccountSkipped(INTEGRATIONS.CANADALIFE, 'acc-1')).toBe(true);
      const account = getAccountData(INTEGRATIONS.CANADALIFE, 'acc-1');
      expect(account.syncEnabled).toBe(false);
    });

    test('should unskip account', () => {
      markAccountAsSkipped(INTEGRATIONS.CANADALIFE, 'acc-1', true);
      markAccountAsSkipped(INTEGRATIONS.CANADALIFE, 'acc-1', false);

      expect(isAccountSkipped(INTEGRATIONS.CANADALIFE, 'acc-1')).toBe(false);
    });

    test('should return false for non-existent account', () => {
      expect(isAccountSkipped(INTEGRATIONS.CANADALIFE, 'non-existent')).toBe(false);
    });
  });

  describe('getAccountSetting / setAccountSetting', () => {
    beforeEach(() => {
      const testAccounts = [
        {
          questradeAccount: { id: 'qt-1' },
          monarchAccount: { id: 'monarch-1' },
          syncEnabled: true,
          storeTransactionDetailsInNotes: true,
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(testAccounts));
    });

    test('should get explicitly set setting', () => {
      const value = getAccountSetting(
        INTEGRATIONS.QUESTRADE,
        'qt-1',
        ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES,
      );
      expect(value).toBe(true);
    });

    test('should return default for unset setting', () => {
      const value = getAccountSetting(
        INTEGRATIONS.QUESTRADE,
        'qt-1',
        ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
      );
      expect(value).toBe(TRANSACTION_RETENTION_DEFAULTS.DAYS);
    });

    test('should return undefined for non-existent account', () => {
      const value = getAccountSetting(
        INTEGRATIONS.QUESTRADE,
        'non-existent',
        ACCOUNT_SETTINGS.STORE_TX_DETAILS_IN_NOTES,
      );
      expect(value).toBeUndefined();
    });

    test('should set setting value', () => {
      setAccountSetting(
        INTEGRATIONS.QUESTRADE,
        'qt-1',
        ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
        180,
      );

      const value = getAccountSetting(
        INTEGRATIONS.QUESTRADE,
        'qt-1',
        ACCOUNT_SETTINGS.TRANSACTION_RETENTION_DAYS,
      );
      expect(value).toBe(180);
    });
  });

  describe('hasLegacyData', () => {
    test('should return true when legacy data exists', () => {
      GM_setValue(`${STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX}acc-1`, '{"id": "monarch-1"}');

      expect(hasLegacyData(INTEGRATIONS.CANADALIFE)).toBe(true);
    });

    test('should return false when no legacy data', () => {
      expect(hasLegacyData(INTEGRATIONS.CANADALIFE)).toBe(false);
    });

    test('should return false for Wealthsimple (already consolidated)', () => {
      expect(hasLegacyData(INTEGRATIONS.WEALTHSIMPLE)).toBe(false);
    });
  });

  describe('migrateFromLegacyStorage', () => {
    test('should migrate legacy accounts to consolidated structure', () => {
      // Set up legacy data
      GM_setValue(
        `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}qt-123`,
        JSON.stringify({ id: 'monarch-1', displayName: 'My TFSA' }),
      );
      GM_setValue(
        `${STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX}qt-123`,
        '2024-01-10',
      );

      const migrated = migrateFromLegacyStorage(INTEGRATIONS.QUESTRADE);

      expect(migrated).toHaveLength(1);
      expect(migrated[0].questradeAccount.id).toBe('qt-123');
      expect(migrated[0].questradeAccount.nickname).toBe('My TFSA');
      expect(migrated[0].monarchAccount.id).toBe('monarch-1');
      expect(migrated[0].lastSyncDate).toBe('2024-01-10');
      expect(migrated[0].syncEnabled).toBe(true);
      expect(migrated[0].transactionRetentionDays).toBe(TRANSACTION_RETENTION_DEFAULTS.DAYS);
    });

    test('should not migrate if no legacy data', () => {
      const migrated = migrateFromLegacyStorage(INTEGRATIONS.QUESTRADE);
      expect(migrated).toEqual([]);
    });

    test('should save migrated accounts to consolidated storage', () => {
      GM_setValue(
        `${STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX}cl-1`,
        JSON.stringify({ id: 'monarch-1', displayName: 'RRSP' }),
      );

      migrateFromLegacyStorage(INTEGRATIONS.CANADALIFE);

      const stored = JSON.parse(GM_getValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, '[]'));
      expect(stored).toHaveLength(1);
    });

    test('should return empty array for Wealthsimple', () => {
      const migrated = migrateFromLegacyStorage(INTEGRATIONS.WEALTHSIMPLE);
      expect(migrated).toEqual([]);
    });
  });

  describe('getMigrationStatus', () => {
    test('should return needsMigration: true when only legacy data exists', () => {
      GM_setValue(
        `${STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX}rb-1`,
        JSON.stringify({ id: 'monarch-1' }),
      );

      const status = getMigrationStatus(INTEGRATIONS.ROGERSBANK);
      expect(status.hasLegacy).toBe(true);
      expect(status.hasConsolidated).toBe(false);
      expect(status.needsMigration).toBe(true);
    });

    test('should return needsMigration: false when consolidated data exists', () => {
      GM_setValue(
        STORAGE.ROGERSBANK_ACCOUNTS_LIST,
        JSON.stringify([{ rogersbankAccount: { id: 'rb-1' } }]),
      );

      const status = getMigrationStatus(INTEGRATIONS.ROGERSBANK);
      expect(status.hasConsolidated).toBe(true);
      expect(status.needsMigration).toBe(false);
    });

    test('should handle both legacy and consolidated existing', () => {
      GM_setValue(
        `${STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX}rb-1`,
        JSON.stringify({ id: 'monarch-1' }),
      );
      GM_setValue(
        STORAGE.ROGERSBANK_ACCOUNTS_LIST,
        JSON.stringify([{ rogersbankAccount: { id: 'rb-1' } }]),
      );

      const status = getMigrationStatus(INTEGRATIONS.ROGERSBANK);
      expect(status.hasLegacy).toBe(true);
      expect(status.hasConsolidated).toBe(true);
      expect(status.needsMigration).toBe(false);
    });
  });

  describe('clearAllAccounts', () => {
    beforeEach(() => {
      // Set up both consolidated and legacy data
      GM_setValue(
        STORAGE.QUESTRADE_ACCOUNTS_LIST,
        JSON.stringify([{ questradeAccount: { id: 'qt-1' } }]),
      );
      GM_setValue(
        `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}qt-1`,
        JSON.stringify({ id: 'monarch-1' }),
      );
      GM_setValue(`${STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX}qt-1`, '2024-01-10');
    });

    test('should clear consolidated storage', () => {
      clearAllAccounts(INTEGRATIONS.QUESTRADE, false);

      const accounts = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
      expect(accounts).toEqual([]);

      // Legacy should remain
      expect(GM_getValue(`${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}qt-1`, null)).not.toBeNull();
    });

    test('should clear both consolidated and legacy when includeLegacy=true', () => {
      clearAllAccounts(INTEGRATIONS.QUESTRADE, true);

      const accounts = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
      expect(accounts).toEqual([]);

      // Legacy should be cleared
      expect(GM_getValue(`${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}qt-1`, null)).toBeNull();
      expect(GM_getValue(`${STORAGE.QUESTRADE_LAST_UPLOAD_DATE_PREFIX}qt-1`, null)).toBeNull();
    });
  });

  describe('auto-migration on getAccounts', () => {
    test('should auto-migrate when consolidated is empty but legacy exists', () => {
      // Set up legacy data
      GM_setValue(
        `${STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX}cl-1`,
        JSON.stringify({ id: 'monarch-1', displayName: 'RRSP' }),
      );

      // Call getAccounts - should trigger migration
      const accounts = getAccounts(INTEGRATIONS.CANADALIFE);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].canadalifAccount.id).toBe('cl-1');

      // Verify consolidated storage was populated
      const stored = JSON.parse(GM_getValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, '[]'));
      expect(stored).toHaveLength(1);
    });

    test('should not re-migrate if consolidated already has data', () => {
      // Set up both
      GM_setValue(
        STORAGE.CANADALIFE_ACCOUNTS_LIST,
        JSON.stringify([{
          canadalifAccount: { id: 'cl-existing', nickname: 'Existing' },
          monarchAccount: { id: 'monarch-existing' },
        }]),
      );
      GM_setValue(
        `${STORAGE.CANADALIFE_ACCOUNT_MAPPING_PREFIX}cl-legacy`,
        JSON.stringify({ id: 'monarch-legacy' }),
      );

      const accounts = getAccounts(INTEGRATIONS.CANADALIFE);

      // Should return existing consolidated data, not migrate legacy
      expect(accounts).toHaveLength(1);
      expect(accounts[0].canadalifAccount.id).toBe('cl-existing');
    });
  });
});
