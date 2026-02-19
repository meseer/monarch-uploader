/**
 * Tests for the generic account mapping resolver
 */

import { resolveAccountMapping } from '../../../src/services/common/accountMappingResolver';

// ── Mocks ───────────────────────────────────────────────────

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    setAccountLogo: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getMonarchAccountMapping: jest.fn(),
    getAccountData: jest.fn(),
    upsertAccount: jest.fn(() => true),
  },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
  },
}));

jest.mock('../../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

const monarchApi = require('../../../src/api/monarch').default;
const accountService = require('../../../src/services/common/accountService').default;
const { showMonarchAccountSelectorWithCreate } = require('../../../src/ui/components/accountSelectorWithCreate');

// ── Test data ───────────────────────────────────────────────

const SAMPLE_MANIFEST = {
  id: 'test-integration',
  displayName: 'Test',
  accountKeyName: 'testAccount',
  logoCloudinaryId: 'production/logos/test-logo',
  accountCreateDefaults: {
    defaultType: 'credit',
    defaultSubtype: 'credit_card',
    accountType: 'credit',
  },
};

const SAMPLE_ACCOUNT = {
  accountId: 'acc-123',
  endingIn: '4201',
  cardName: 'Test Card',
  displayName: 'Test Card (4201)',
};

const buildAccountEntry = (account) => ({
  id: account.accountId,
  endingIn: account.endingIn,
  cardName: account.cardName,
  nickname: account.displayName,
});

// ── Tests ───────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolveAccountMapping', () => {
  it('should return existing mapping when one exists', async () => {
    const existingMapping = { id: 'monarch-1', displayName: 'Existing Card' };
    accountService.getMonarchAccountMapping.mockReturnValue(existingMapping);

    const result = await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(result).toEqual({ monarchAccount: existingMapping });
    expect(showMonarchAccountSelectorWithCreate).not.toHaveBeenCalled();
  });

  it('should return skipped when account was previously skipped', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue({ syncEnabled: false });

    const result = await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(result).toEqual({ skipped: true });
    expect(showMonarchAccountSelectorWithCreate).not.toHaveBeenCalled();
  });

  it('should return cancelled when user cancels selector (null)', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback(null);
    });

    const result = await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(result).toEqual({ cancelled: true });
  });

  it('should return cancelled when user clicks cancel button', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback({ cancelled: true });
    });

    const result = await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(result).toEqual({ cancelled: true });
  });

  it('should save skipped account when user clicks skip', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback({ skipped: true });
    });

    const result = await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(result).toEqual({ skipped: true });
    expect(accountService.upsertAccount).toHaveBeenCalledWith('test', {
      testAccount: {
        id: 'acc-123',
        endingIn: '4201',
        cardName: 'Test Card',
        nickname: 'Test Card (4201)',
      },
      monarchAccount: null,
      syncEnabled: false,
      lastSyncDate: null,
    });
  });

  it('should save mapping when user selects an account', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    const selectedAccount = { id: 'monarch-2', displayName: 'My Card' };
    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback(selectedAccount);
    });

    const result = await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(result).toEqual({ monarchAccount: selectedAccount });
    expect(accountService.upsertAccount).toHaveBeenCalledWith('test', {
      testAccount: {
        id: 'acc-123',
        endingIn: '4201',
        cardName: 'Test Card',
        nickname: 'Test Card (4201)',
      },
      monarchAccount: { id: 'monarch-2', displayName: 'My Card' },
      syncEnabled: true,
      lastSyncDate: null,
    });
  });

  it('should set logo on newly created accounts', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    const newAccount = { id: 'monarch-new', displayName: 'New Card', newlyCreated: true };
    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback(newAccount);
    });

    await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(monarchApi.setAccountLogo).toHaveBeenCalledWith('monarch-new', 'production/logos/test-logo');
  });

  it('should not set logo when logoCloudinaryId is null', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    const noLogoManifest = { ...SAMPLE_MANIFEST, logoCloudinaryId: null };
    const newAccount = { id: 'monarch-new', displayName: 'New Card', newlyCreated: true };
    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback(newAccount);
    });

    await resolveAccountMapping({
      integrationId: 'test',
      manifest: noLogoManifest,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(monarchApi.setAccountLogo).not.toHaveBeenCalled();
  });

  it('should not set logo when account is not newly created', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    const existingAccount = { id: 'monarch-existing', displayName: 'Existing Card' };
    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback(existingAccount);
    });

    await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(monarchApi.setAccountLogo).not.toHaveBeenCalled();
  });

  it('should handle logo set failure gracefully', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    const newAccount = { id: 'monarch-new', displayName: 'New Card', newlyCreated: true };
    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback(newAccount);
    });
    monarchApi.setAccountLogo.mockRejectedValue(new Error('Logo upload failed'));

    const result = await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    // Should still return success — logo is non-fatal
    expect(result).toEqual({ monarchAccount: newAccount });
  });

  it('should pass manifest accountCreateDefaults to account selector', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback(null);
    });

    await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry,
    });

    expect(showMonarchAccountSelectorWithCreate).toHaveBeenCalledWith(
      [],
      expect.any(Function),
      null,
      'credit',
      expect.objectContaining({
        defaultName: 'Test Card (4201)',
        defaultType: 'credit',
        defaultSubtype: 'credit_card',
        accountType: 'credit',
      }),
    );
  });

  it('should use buildAccountEntry hook for storage shape', async () => {
    accountService.getMonarchAccountMapping.mockReturnValue(null);
    accountService.getAccountData.mockReturnValue(null);

    const customBuildEntry = jest.fn((account) => ({
      id: account.accountId,
      custom: 'field',
    }));

    showMonarchAccountSelectorWithCreate.mockImplementation((_accts, callback) => {
      callback({ skipped: true });
    });

    await resolveAccountMapping({
      integrationId: 'test',
      manifest: SAMPLE_MANIFEST,
      account: SAMPLE_ACCOUNT,
      accountDisplayName: 'Test Card (4201)',
      buildAccountEntry: customBuildEntry,
    });

    expect(customBuildEntry).toHaveBeenCalledWith(SAMPLE_ACCOUNT);
    expect(accountService.upsertAccount).toHaveBeenCalledWith('test', expect.objectContaining({
      testAccount: { id: 'acc-123', custom: 'field' },
    }));
  });
});