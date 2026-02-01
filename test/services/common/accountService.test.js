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

  describe('stale raw cache detection (Questrade-specific)', () => {
    // Before v5.58.2, Questrade API incorrectly wrote raw account cache to ACCOUNTS_LIST
    // This tests the auto-detection and cleanup of that stale data

    test('should detect and clear stale raw cache data for Questrade', () => {
      // Set up stale raw cache data (format: [{key, number, type, ...}])
      // This is what the old Questrade API incorrectly wrote to ACCOUNTS_LIST
      const staleRawCache = [
        { key: 'qt-uuid-1', number: '12345', type: 'Margin', nickname: 'My Margin' },
        { key: 'qt-uuid-2', number: '67890', type: 'TFSA', nickname: 'My TFSA' },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(staleRawCache));

      // Also set up legacy mapping data that should be migrated
      GM_setValue(
        `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}qt-uuid-1`,
        JSON.stringify({ id: 'monarch-1', displayName: 'Margin Account' }),
      );

      // Call getAccounts - should detect stale cache, clear it, and migrate legacy
      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      // Should have migrated from legacy, not returned stale cache
      expect(accounts).toHaveLength(1);
      expect(accounts[0].questradeAccount.id).toBe('qt-uuid-1');
      expect(accounts[0].monarchAccount.id).toBe('monarch-1');

      // Verify the stale cache was cleared
      const stored = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
      expect(stored).toHaveLength(1);
      // Should be consolidated format, not raw cache
      expect(stored[0].questradeAccount).toBeDefined();
      expect(stored[0].key).toBeUndefined();
    });

    test('should not clear valid consolidated data for Questrade', () => {
      // Set up proper consolidated format data
      const consolidatedData = [
        {
          questradeAccount: { id: 'qt-uuid-1', nickname: 'My Margin' },
          monarchAccount: { id: 'monarch-1', displayName: 'Margin Account' },
          syncEnabled: true,
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(consolidatedData));

      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      // Should return consolidated data as-is
      expect(accounts).toHaveLength(1);
      expect(accounts[0].questradeAccount.id).toBe('qt-uuid-1');
      expect(accounts[0].monarchAccount.id).toBe('monarch-1');
    });

    test('should not affect other integrations with similar data shape', () => {
      // CanadaLife might have data with 'key' field, but shouldn't be affected
      // by Questrade-specific stale cache detection
      const canadalifData = [
        { canadalifAccount: { id: 'cl-1', nickname: 'RRSP' }, monarchAccount: { id: 'm-1' } },
      ];
      GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, JSON.stringify(canadalifData));

      const accounts = getAccounts(INTEGRATIONS.CANADALIFE);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].canadalifAccount.id).toBe('cl-1');
    });

    test('should handle stale cache with no legacy data to migrate', () => {
      // Set up stale raw cache data without any legacy mapping keys
      const staleRawCache = [
        { key: 'qt-uuid-1', number: '12345', type: 'Margin' },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(staleRawCache));

      // No legacy mapping data

      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      // Should clear stale cache and return empty (no legacy to migrate)
      expect(accounts).toEqual([]);

      // Verify storage was cleared
      const stored = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
      expect(stored).toEqual([]);
    });

    test('should identify stale cache by presence of key field without questradeAccount', () => {
      // Edge case: data has 'key' but also has 'questradeAccount' (valid migrated data)
      // This should NOT be detected as stale
      const validData = [
        {
          key: 'some-key', // This might exist from old migration
          questradeAccount: { id: 'qt-1', nickname: 'Test' },
          monarchAccount: { id: 'm-1' },
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(validData));

      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      // Should return data as-is since questradeAccount exists
      expect(accounts).toHaveLength(1);
      expect(accounts[0].questradeAccount.id).toBe('qt-1');
    });
  });

  describe('legacy uploaded transactions migration', () => {
    test('should migrate legacy uploaded orders for Questrade during full migration', () => {
      // Set up legacy mapping data
      GM_setValue(
        `${STORAGE.QUESTRADE_ACCOUNT_MAPPING_PREFIX}qt-uuid-1`,
        JSON.stringify({ id: 'monarch-1', displayName: 'TFSA' }),
      );
      // Set up legacy uploaded orders (array of strings)
      GM_setValue(
        `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}qt-uuid-1`,
        ['order-1', 'order-2', 'order-3'],
      );

      // Call getAccounts - should trigger migration including transactions
      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].uploadedTransactions).toHaveLength(3);
      expect(accounts[0].uploadedTransactions[0]).toEqual({ id: 'order-1', date: null });
      expect(accounts[0].uploadedTransactions[1]).toEqual({ id: 'order-2', date: null });
      expect(accounts[0].uploadedTransactions[2]).toEqual({ id: 'order-3', date: null });
    });

    test('should merge legacy transactions into already-migrated accounts', () => {
      // Set up already-migrated consolidated data WITHOUT uploadedTransactions
      const consolidatedData = [
        {
          questradeAccount: { id: 'qt-uuid-1', nickname: 'TFSA' },
          monarchAccount: { id: 'monarch-1' },
          syncEnabled: true,
          // Note: no uploadedTransactions field
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(consolidatedData));

      // Set up legacy uploaded orders that need to be merged
      GM_setValue(
        `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}qt-uuid-1`,
        ['order-a', 'order-b'],
      );

      // Call getAccounts - should merge legacy transactions
      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].uploadedTransactions).toHaveLength(2);
      expect(accounts[0].uploadedTransactions[0].id).toBe('order-a');
    });

    test('should not overwrite existing uploadedTransactions', () => {
      // Set up consolidated data WITH uploadedTransactions already populated
      const consolidatedData = [
        {
          questradeAccount: { id: 'qt-uuid-1', nickname: 'TFSA' },
          monarchAccount: { id: 'monarch-1' },
          syncEnabled: true,
          uploadedTransactions: [{ id: 'existing-1', date: '2024-01-10' }],
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(consolidatedData));

      // Set up legacy data that should be ignored
      GM_setValue(
        `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}qt-uuid-1`,
        ['should-not-appear'],
      );

      // Call getAccounts - should NOT overwrite existing transactions
      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      expect(accounts[0].uploadedTransactions).toHaveLength(1);
      expect(accounts[0].uploadedTransactions[0].id).toBe('existing-1');
      expect(accounts[0].uploadedTransactions[0].date).toBe('2024-01-10');
    });

    test('should handle Rogers Bank legacy transaction refs', () => {
      // Set up legacy data for Rogers Bank
      GM_setValue(
        `${STORAGE.ROGERSBANK_ACCOUNT_MAPPING_PREFIX}rb-123`,
        JSON.stringify({ id: 'monarch-rb', displayName: 'Rogers CC' }),
      );
      GM_setValue(
        `${STORAGE.ROGERSBANK_UPLOADED_REFS_PREFIX}rb-123`,
        ['ref-001', 'ref-002'],
      );

      // Call getAccounts
      const accounts = getAccounts(INTEGRATIONS.ROGERSBANK);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].uploadedTransactions).toHaveLength(2);
      expect(accounts[0].uploadedTransactions[0].id).toBe('ref-001');
    });

    test('should not try to merge transactions for CanadaLife (no deduplication)', () => {
      // Set up consolidated data for CanadaLife
      const consolidatedData = [
        {
          canadalifAccount: { id: 'cl-1', nickname: 'RRSP' },
          monarchAccount: { id: 'monarch-cl' },
          syncEnabled: true,
        },
      ];
      GM_setValue(STORAGE.CANADALIFE_ACCOUNTS_LIST, JSON.stringify(consolidatedData));

      // CanadaLife doesn't have uploaded transactions prefix, so nothing to merge
      const accounts = getAccounts(INTEGRATIONS.CANADALIFE);

      expect(accounts).toHaveLength(1);
      expect(accounts[0].uploadedTransactions).toBeUndefined();
    });

    test('should save merged accounts after migration', () => {
      // Set up consolidated data without transactions
      const consolidatedData = [
        {
          questradeAccount: { id: 'qt-1', nickname: 'Account' },
          monarchAccount: { id: 'm-1' },
          syncEnabled: true,
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(consolidatedData));

      // Set up legacy transactions
      GM_setValue(`${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}qt-1`, ['tx-1']);

      // Trigger merge
      getAccounts(INTEGRATIONS.QUESTRADE);

      // Verify the consolidated storage was updated
      const stored = JSON.parse(GM_getValue(STORAGE.ACCOUNTS_LIST, '[]'));
      expect(stored[0].uploadedTransactions).toHaveLength(1);
      expect(stored[0].uploadedTransactions[0].id).toBe('tx-1');
    });

    test('should handle JSON string format for legacy transactions', () => {
      // Set up consolidated data
      const consolidatedData = [
        {
          questradeAccount: { id: 'qt-1', nickname: 'Account' },
          monarchAccount: { id: 'm-1' },
          syncEnabled: true,
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(consolidatedData));

      // Set up legacy transactions as JSON string instead of direct array
      GM_setValue(
        `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}qt-1`,
        JSON.stringify(['tx-json-1', 'tx-json-2']),
      );

      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      expect(accounts[0].uploadedTransactions).toHaveLength(2);
      expect(accounts[0].uploadedTransactions[0].id).toBe('tx-json-1');
    });

    test('should handle object format for legacy transactions', () => {
      // Set up consolidated data
      const consolidatedData = [
        {
          questradeAccount: { id: 'qt-1', nickname: 'Account' },
          monarchAccount: { id: 'm-1' },
          syncEnabled: true,
        },
      ];
      GM_setValue(STORAGE.ACCOUNTS_LIST, JSON.stringify(consolidatedData));

      // Set up legacy transactions already in object format
      GM_setValue(
        `${STORAGE.QUESTRADE_UPLOADED_ORDERS_PREFIX}qt-1`,
        [
          { id: 'tx-obj-1', date: '2024-01-15' },
          { id: 'tx-obj-2', date: '2024-01-16' },
        ],
      );

      const accounts = getAccounts(INTEGRATIONS.QUESTRADE);

      expect(accounts[0].uploadedTransactions).toHaveLength(2);
      expect(accounts[0].uploadedTransactions[0]).toEqual({ id: 'tx-obj-1', date: '2024-01-15' });
    });
  });
});
