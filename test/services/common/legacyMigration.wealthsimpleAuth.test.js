/**
 * Tests for the purge of Wealthsimple auth stored by earlier versions
 * (purgeStoredWealthsimpleAuth).
 *
 * The Wealthsimple token is now read from the page's OAuth cookie on demand.
 * Older versions copied it into `wealthsimple_config.auth`, and before that
 * into individual `wealthsimple_*` keys. These tests run against the real
 * configStore and an in-memory GM store, so they check the actual JSON left
 * behind.
 */

import {
  purgeStoredWealthsimpleAuth,
  migrateAllLegacyStorage,
} from '../../../src/services/common/legacyMigration';

import { useInMemoryGmStorage } from '../../helpers/wealthsimpleAuthCookie';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

const STORED_AUTH = {
  accessToken: 'stored-access-token',
  identityId: 'identity-123',
  expiresAt: '2026-01-01T00:00:00Z',
  investProfile: 'invest-456',
  tradeProfile: 'trade-789',
};

const LEGACY_AUTH_KEYS = {
  wealthsimple_auth_token: 'legacy-auth-token',
  wealthsimple_access_token: 'legacy-access-token',
  wealthsimple_identity_id: 'identity-123',
  wealthsimple_token_expires_at: '2026-01-01T00:00:00Z',
  wealthsimple_invest_profile: 'invest-456',
  wealthsimple_trade_profile: 'trade-789',
};

const SETTINGS = { lookbackDays: 7 };
const CATEGORY_MAPPINGS = { RESTAURANTS: 'Dining' };
const HOLDINGS_MAPPINGS = { 'sec-1': { securityId: 's1', holdingId: 'h1', symbol: 'VFV' } };
const ACCOUNTS_LIST = JSON.stringify([
  { wealthsimpleAccount: { id: 'tfsa-1', nickname: 'TFSA' }, monarchAccount: { id: 'm-1' }, syncEnabled: true },
]);

function storedConfig(store) {
  return JSON.parse(store.get('wealthsimple_config'));
}

describe('purgeStoredWealthsimpleAuth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('deletes the auth section of wealthsimple_config and keeps everything else', () => {
    const store = useInMemoryGmStorage({
      wealthsimple_config: JSON.stringify({
        auth: STORED_AUTH,
        settings: SETTINGS,
        categoryMappings: CATEGORY_MAPPINGS,
        holdingsMappings: HOLDINGS_MAPPINGS,
      }),
      wealthsimple_accounts_list: ACCOUNTS_LIST,
    });

    const deleted = purgeStoredWealthsimpleAuth();

    expect(deleted).toBe(1);
    expect(storedConfig(store)).toEqual({
      settings: SETTINGS,
      categoryMappings: CATEGORY_MAPPINGS,
      holdingsMappings: HOLDINGS_MAPPINGS,
    });
    expect(store.get('wealthsimple_accounts_list')).toBe(ACCOUNTS_LIST);
    expect(JSON.stringify(Array.from(store.entries()))).not.toContain('stored-access-token');
  });

  test('deletes every legacy individual auth key', () => {
    const store = useInMemoryGmStorage({
      ...LEGACY_AUTH_KEYS,
      wealthsimple_accounts_list: ACCOUNTS_LIST,
    });

    const deleted = purgeStoredWealthsimpleAuth();

    expect(deleted).toBe(6);
    expect(Array.from(store.keys())).toEqual(['wealthsimple_accounts_list']);
  });

  test('deletes both generations of stored auth in one run', () => {
    const store = useInMemoryGmStorage({
      ...LEGACY_AUTH_KEYS,
      wealthsimple_config: JSON.stringify({ auth: STORED_AUTH, settings: SETTINGS }),
    });

    expect(purgeStoredWealthsimpleAuth()).toBe(7);
    expect(Array.from(store.keys())).toEqual(['wealthsimple_config']);
    expect(storedConfig(store)).toEqual({ settings: SETTINGS });
  });

  test('is idempotent: a second run deletes and writes nothing', () => {
    useInMemoryGmStorage({
      ...LEGACY_AUTH_KEYS,
      wealthsimple_config: JSON.stringify({ auth: STORED_AUTH, settings: SETTINGS }),
    });
    purgeStoredWealthsimpleAuth();
    jest.clearAllMocks();

    expect(purgeStoredWealthsimpleAuth()).toBe(0);
    expect(GM_setValue).not.toHaveBeenCalled();
    expect(GM_deleteValue).not.toHaveBeenCalled();
  });

  test('does not create wealthsimple_config for users who never stored Wealthsimple data', () => {
    const store = useInMemoryGmStorage();

    expect(purgeStoredWealthsimpleAuth()).toBe(0);
    expect(store.size).toBe(0);
    expect(GM_setValue).not.toHaveBeenCalled();
  });

  test('leaves a config without an auth section untouched', () => {
    const config = JSON.stringify({ settings: SETTINGS, categoryMappings: CATEGORY_MAPPINGS });
    const store = useInMemoryGmStorage({ wealthsimple_config: config });

    expect(purgeStoredWealthsimpleAuth()).toBe(0);
    expect(GM_setValue).not.toHaveBeenCalled();
    expect(store.get('wealthsimple_config')).toBe(config);
  });

  test('does not touch other integrations', () => {
    const rogersConfig = JSON.stringify({ settings: SETTINGS });
    const store = useInMemoryGmStorage({
      wealthsimple_config: JSON.stringify({ auth: STORED_AUTH }),
      rogersbank_config: rogersConfig,
      questrade_accounts_list: '[]',
    });

    purgeStoredWealthsimpleAuth();

    expect(store.get('rogersbank_config')).toBe(rogersConfig);
    expect(store.get('questrade_accounts_list')).toBe('[]');
  });

  test('keeps going when a legacy key cannot be read', () => {
    const store = useInMemoryGmStorage({
      wealthsimple_trade_profile: 'trade-789',
      wealthsimple_config: JSON.stringify({ auth: STORED_AUTH }),
    });
    const readFromStore = GM_getValue.getMockImplementation();
    GM_getValue.mockImplementation((key, defaultValue) => {
      if (key === 'wealthsimple_access_token') throw new Error('Storage error');
      return readFromStore(key, defaultValue);
    });

    expect(purgeStoredWealthsimpleAuth()).toBe(2);
    expect(store.has('wealthsimple_trade_profile')).toBe(false);
    expect(storedConfig(store)).toEqual({});
  });

  test('runs as part of the eager migration at script load', () => {
    const store = useInMemoryGmStorage({
      wealthsimple_access_token: 'legacy-access-token',
      wealthsimple_config: JSON.stringify({ auth: STORED_AUTH, categoryMappings: CATEGORY_MAPPINGS }),
    });

    migrateAllLegacyStorage();

    expect(store.has('wealthsimple_access_token')).toBe(false);
    expect(storedConfig(store)).toEqual({ categoryMappings: CATEGORY_MAPPINGS });
  });
});
