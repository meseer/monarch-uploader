/**
 * Tests for the one-time purge of Rogers Bank credentials stored by earlier
 * versions (purgeStoredRogersBankCredentials).
 *
 * Rogers Bank credentials are now held in memory only. Older versions stored
 * them under individual legacy keys and later in `rogersbank_config.auth`.
 * These tests run against the real configStore and an in-memory GM store, so
 * they check the actual JSON left behind.
 */

import {
  purgeStoredRogersBankCredentials,
  migrateAllLegacyStorage,
} from '../../../src/services/common/legacyMigration';

import { useInMemoryGmStorage } from '../../helpers/rogersBankPage';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

const LEGACY_CREDENTIAL_KEYS = {
  rogersbank_auth_token: 'Bearer legacy-token',
  rogersbank_account_id: 'legacy-account',
  rogersbank_customer_id: 'legacy-customer',
  rogersbank_account_id_encoded: 'legacy-enc-account',
  rogersbank_customer_id_encoded: 'legacy-enc-customer',
  rogersbank_device_id: 'legacy-device',
  rogersbank_last_updated: '2024-01-01T00:00:00Z',
};

const SETTINGS = { lookbackDays: 7 };
const CATEGORY_MAPPINGS = { RESTAURANTS: 'Dining' };
const ACCOUNTS_LIST = JSON.stringify([
  { rogersbankAccount: { id: '12345', nickname: 'Rogers Card' }, monarchAccount: { id: 'm-1' }, syncEnabled: true },
]);

function storedConfig(store) {
  return JSON.parse(store.get('rogersbank_config'));
}

describe('purgeStoredRogersBankCredentials', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deletes the auth section of rogersbank_config and keeps everything else', () => {
    const store = useInMemoryGmStorage({
      rogersbank_config: JSON.stringify({
        auth: { authToken: 'Bearer stored-token', deviceId: 'stored-device', accountIdEncoded: 'stored-enc' },
        settings: SETTINGS,
        categoryMappings: CATEGORY_MAPPINGS,
      }),
      rogersbank_accounts_list: ACCOUNTS_LIST,
    });

    const deleted = purgeStoredRogersBankCredentials();

    expect(deleted).toBe(1);
    expect(storedConfig(store)).toEqual({ settings: SETTINGS, categoryMappings: CATEGORY_MAPPINGS });
    expect(store.get('rogersbank_accounts_list')).toBe(ACCOUNTS_LIST);
  });

  test('deletes every legacy credential key', () => {
    const store = useInMemoryGmStorage({
      ...LEGACY_CREDENTIAL_KEYS,
      rogersbank_lookback_days: 14,
      rogersbank_accounts_list: ACCOUNTS_LIST,
    });

    const deleted = purgeStoredRogersBankCredentials();

    expect(deleted).toBe(7);
    Object.keys(LEGACY_CREDENTIAL_KEYS).forEach((key) => {
      expect(store.has(key)).toBe(false);
    });
    // Not credentials: left for their own migrations or kept as-is
    expect(store.get('rogersbank_lookback_days')).toBe(14);
    expect(store.get('rogersbank_accounts_list')).toBe(ACCOUNTS_LIST);
  });

  test('does not copy legacy credentials into rogersbank_config', () => {
    const store = useInMemoryGmStorage({
      ...LEGACY_CREDENTIAL_KEYS,
      rogersbank_config: JSON.stringify({ settings: SETTINGS }),
    });

    purgeStoredRogersBankCredentials();

    expect(storedConfig(store)).toEqual({ settings: SETTINGS });
    expect(GM_setValue).not.toHaveBeenCalled();
  });

  test('deletes both generations of stored credentials in one run', () => {
    const store = useInMemoryGmStorage({
      ...LEGACY_CREDENTIAL_KEYS,
      rogersbank_config: JSON.stringify({ auth: { authToken: 'Bearer stored-token' }, settings: SETTINGS }),
    });

    expect(purgeStoredRogersBankCredentials()).toBe(8);
    expect(Array.from(store.keys())).toEqual(['rogersbank_config']);
    expect(storedConfig(store)).toEqual({ settings: SETTINGS });
  });

  test('is idempotent: a second run deletes and writes nothing', () => {
    useInMemoryGmStorage({
      ...LEGACY_CREDENTIAL_KEYS,
      rogersbank_config: JSON.stringify({ auth: { authToken: 'Bearer stored-token' }, settings: SETTINGS }),
    });
    purgeStoredRogersBankCredentials();
    jest.clearAllMocks();

    expect(purgeStoredRogersBankCredentials()).toBe(0);
    expect(GM_setValue).not.toHaveBeenCalled();
    expect(GM_deleteValue).not.toHaveBeenCalled();
  });

  test('does not create rogersbank_config for users who never stored Rogers data', () => {
    const store = useInMemoryGmStorage();

    expect(purgeStoredRogersBankCredentials()).toBe(0);
    expect(store.size).toBe(0);
    expect(GM_setValue).not.toHaveBeenCalled();
  });

  test('leaves a config without an auth section untouched', () => {
    useInMemoryGmStorage({ rogersbank_config: JSON.stringify({ settings: SETTINGS }) });

    expect(purgeStoredRogersBankCredentials()).toBe(0);
    expect(GM_setValue).not.toHaveBeenCalled();
  });

  test('keeps going when a legacy key cannot be read', () => {
    const store = useInMemoryGmStorage({
      rogersbank_device_id: 'legacy-device',
      rogersbank_config: JSON.stringify({ auth: { authToken: 'Bearer stored-token' } }),
    });
    const readFromStore = GM_getValue.getMockImplementation();
    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'rogersbank_auth_token') throw new Error('Storage error');
      return readFromStore(key, defaultValue);
    });

    expect(purgeStoredRogersBankCredentials()).toBe(2);
    expect(store.has('rogersbank_device_id')).toBe(false);
    expect(storedConfig(store)).toEqual({});
  });

  test('runs as part of the eager migration at script load', () => {
    const store = useInMemoryGmStorage({
      rogersbank_auth_token: 'Bearer legacy-token',
      rogersbank_config: JSON.stringify({ auth: { authToken: 'Bearer stored-token' }, categoryMappings: CATEGORY_MAPPINGS }),
    });

    migrateAllLegacyStorage();

    expect(store.has('rogersbank_auth_token')).toBe(false);
    expect(storedConfig(store)).toEqual({ categoryMappings: CATEGORY_MAPPINGS });
  });
});
