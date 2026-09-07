/**
 * Tests for persisting the cardholder sync choices made during account creation
 *
 * The creation dialog *reports* the user's choices; this resolver *persists*
 * them, folded into the `upsertAccount` payload it already writes. That split
 * exists because the dialog knows the Monarch account it created but not the
 * source account these settings belong to — and because storage writes belong in
 * the service layer, not in generic UI.
 *
 * Properties worth protecting:
 *
 * - the capability flag is passed to the dialog (never an integration id)
 * - reported choices land in the SAME write as the mapping, not a second one
 * - integrations without the capability, and skip/cancel paths, are unaffected
 */

import { resolveAccountMapping } from '../../../src/services/common/accountMappingResolver';

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/core/integrationCapabilities', () => ({
  ACCOUNT_SETTINGS: {
    CARDHOLDER_OWNER_MODE: 'cardholderOwnerMode',
    CARDHOLDER_TAG_MODE: 'cardholderTagMode',
  },
  hasCapability: jest.fn(),
}));

jest.mock('../../../src/api/monarch', () => ({
  __esModule: true,
  default: { setAccountLogo: jest.fn() },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getMonarchAccountMapping: jest.fn(() => null),
    getAccountData: jest.fn(() => null),
    upsertAccount: jest.fn(),
  },
}));

jest.mock('../../../src/ui/components/accountSelectorWithCreate', () => ({
  showMonarchAccountSelectorWithCreate: jest.fn(),
}));

const accountService = require('../../../src/services/common/accountService').default;
const { hasCapability } = require('../../../src/core/integrationCapabilities');
const {
  showMonarchAccountSelectorWithCreate,
} = require('../../../src/ui/components/accountSelectorWithCreate');

const MANIFEST = {
  accountKeyName: 'rogersbankAccount',
  accountCreateDefaults: { defaultType: 'credit', accountType: 'credit' },
  logoCloudinaryId: null,
};

/** Make the selector resolve with a given account object */
const selectorResolvesWith = (account) => {
  showMonarchAccountSelectorWithCreate.mockImplementation(
    (_accounts, callback) => callback(account),
  );
};

const resolve = () => resolveAccountMapping({
  integrationId: 'rogersbank',
  manifest: MANIFEST,
  account: { accountId: 'rb-acct-1' },
  accountDisplayName: 'Rogers Mastercard',
  buildAccountEntry: (a) => ({ id: a.accountId, nickname: 'Rogers Mastercard' }),
});

/** The payload handed to upsertAccount */
const upsertPayload = () => accountService.upsertAccount.mock.calls[0][1];

/** The createDefaults handed to the selector */
const createDefaults = () => showMonarchAccountSelectorWithCreate.mock.calls[0][4];

beforeEach(() => {
  jest.clearAllMocks();
  accountService.getMonarchAccountMapping.mockReturnValue(null);
  accountService.getAccountData.mockReturnValue(null);
  hasCapability.mockReturnValue(true);
  selectorResolvesWith({ id: 'monarch-1', displayName: 'Rogers Card' });
});

describe('passing the capability to the dialog', () => {
  it('passes supportsCardholders: true for a cardholder-capable integration', async () => {
    hasCapability.mockReturnValue(true);

    await resolve();

    expect(createDefaults().supportsCardholders).toBe(true);
  });

  it('passes supportsCardholders: false otherwise', async () => {
    hasCapability.mockReturnValue(false);

    await resolve();

    expect(createDefaults().supportsCardholders).toBe(false);
  });

  it('asks specifically about the hasCardholders capability', async () => {
    await resolve();

    expect(hasCapability).toHaveBeenCalledWith('rogersbank', 'hasCardholders');
  });

  it('does NOT pass an integration id to the dialog', async () => {
    // The dialog is generic Monarch-account UI; a capability answer keeps it so
    await resolve();

    expect(createDefaults().integrationId).toBeUndefined();
  });
});

describe('persisting the reported choices', () => {
  it('stores both modes when the dialog reported them', async () => {
    selectorResolvesWith({
      id: 'monarch-1',
      displayName: 'Rogers Card',
      cardholderOwnerMode: 'on',
      cardholderTagMode: 'auto',
    });

    await resolve();

    expect(upsertPayload()).toMatchObject({
      cardholderOwnerMode: 'on',
      cardholderTagMode: 'auto',
    });
  });

  it('stores explicit off values, so the settings exist from the start', async () => {
    selectorResolvesWith({
      id: 'monarch-1',
      displayName: 'Rogers Card',
      cardholderOwnerMode: 'off',
      cardholderTagMode: 'off',
    });

    await resolve();

    expect(upsertPayload()).toMatchObject({
      cardholderOwnerMode: 'off',
      cardholderTagMode: 'off',
    });
  });

  it('writes them in the SAME call as the mapping, not a second one', async () => {
    // One write means no ordering concern about whether the entry exists yet
    selectorResolvesWith({
      id: 'monarch-1',
      displayName: 'Rogers Card',
      cardholderOwnerMode: 'on',
      cardholderTagMode: 'always',
    });

    await resolve();

    expect(accountService.upsertAccount).toHaveBeenCalledTimes(1);
    expect(upsertPayload()).toMatchObject({
      rogersbankAccount: expect.any(Object),
      monarchAccount: expect.any(Object),
      syncEnabled: true,
      cardholderOwnerMode: 'on',
    });
  });

  it('omits the keys entirely when the dialog reported nothing', async () => {
    // An existing account was selected, or the integration lacks the capability
    selectorResolvesWith({ id: 'monarch-1', displayName: 'Rogers Card' });

    await resolve();

    expect(upsertPayload()).not.toHaveProperty('cardholderOwnerMode');
    expect(upsertPayload()).not.toHaveProperty('cardholderTagMode');
  });

  it('ignores non-string values rather than persisting junk', async () => {
    selectorResolvesWith({
      id: 'monarch-1',
      displayName: 'Rogers Card',
      cardholderOwnerMode: true,
      cardholderTagMode: 42,
    });

    await resolve();

    expect(upsertPayload()).not.toHaveProperty('cardholderOwnerMode');
    expect(upsertPayload()).not.toHaveProperty('cardholderTagMode');
  });

  it('persists one mode even if the other is missing', async () => {
    selectorResolvesWith({
      id: 'monarch-1',
      displayName: 'Rogers Card',
      cardholderTagMode: 'always',
    });

    await resolve();

    expect(upsertPayload()).toMatchObject({ cardholderTagMode: 'always' });
    expect(upsertPayload()).not.toHaveProperty('cardholderOwnerMode');
  });

  it('still stores the mapping itself unchanged', async () => {
    selectorResolvesWith({
      id: 'monarch-1',
      displayName: 'Rogers Card',
      cardholderOwnerMode: 'on',
      cardholderTagMode: 'auto',
    });

    await resolve();

    expect(upsertPayload()).toMatchObject({
      monarchAccount: { id: 'monarch-1', displayName: 'Rogers Card' },
      syncEnabled: true,
      lastSyncDate: null,
    });
  });
});

describe('paths that must not persist cardholder settings', () => {
  it('writes no cardholder settings when the account is skipped', async () => {
    selectorResolvesWith({ skipped: true, cardholderTagMode: 'always' });

    const result = await resolve();

    expect(result.skipped).toBe(true);
    expect(upsertPayload()).not.toHaveProperty('cardholderTagMode');
  });

  it('writes nothing at all when cancelled', async () => {
    selectorResolvesWith({ cancelled: true });

    const result = await resolve();

    expect(result.cancelled).toBe(true);
    expect(accountService.upsertAccount).not.toHaveBeenCalled();
  });

  it('writes nothing when the selector resolves with null', async () => {
    selectorResolvesWith(null);

    const result = await resolve();

    expect(result.cancelled).toBe(true);
    expect(accountService.upsertAccount).not.toHaveBeenCalled();
  });

  it('does not re-prompt or rewrite for an already-mapped account', async () => {
    // Existing accounts keep their settings; changes go through the settings modal
    accountService.getMonarchAccountMapping.mockReturnValue({
      id: 'monarch-1', displayName: 'Rogers Card',
    });

    const result = await resolve();

    expect(result.monarchAccount).toMatchObject({ id: 'monarch-1' });
    expect(showMonarchAccountSelectorWithCreate).not.toHaveBeenCalled();
    expect(accountService.upsertAccount).not.toHaveBeenCalled();
  });
});