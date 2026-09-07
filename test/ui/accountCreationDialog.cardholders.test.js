/**
 * Tests for the cardholder sync controls in the account creation dialog
 *
 * The dialog is a **pure form** for this feature: it receives a
 * `supportsCardholders` capability flag and *reports* the user's choices on the
 * resolved account object. It deliberately does not persist them — the settings
 * live on the *source* account, whose id the dialog never learns — so the caller
 * folds them into the mapping write it is already performing.
 *
 * Properties worth protecting:
 *
 * - the section appears only for integrations that support cardholders
 * - both controls default to off, so an ignored section changes nothing
 * - owner mapping is disabled *with a stated reason* for a single-member
 *   household, while tagging stays available
 * - the choices come back on the resolved account for the caller to persist
 */

import { showAccountCreationDialog } from '../../src/ui/components/accountCreationDialog';

jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../src/core/config', () => ({
  CARDHOLDER: {
    SHARED_OWNER: 'Shared',
    OWNER_MODE: { OFF: 'off', ON: 'on' },
    TAG_MODE: { OFF: 'off', AUTO: 'auto', ALWAYS: 'always' },
  },
  ALL_MARKER_TAGS: ['Pending', 'pendingOwnerUpdate'],
}));

jest.mock('../../src/ui/keyboardNavigation', () => ({
  addModalKeyboardHandlers: jest.fn(() => jest.fn()),
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../src/api/monarch', () => ({
  __esModule: true,
  default: {
    getAccountTypeOptions: jest.fn(),
    createManualAccount: jest.fn(),
    createManualInvestmentsAccount: jest.fn(),
    listAccounts: jest.fn(),
    updateAccount: jest.fn(),
  },
}));

jest.mock('../../src/api/monarchHousehold', () => ({
  getHouseholdMembers: jest.fn(),
}));

const monarchApi = require('../../src/api/monarch').default;
const { getHouseholdMembers } = require('../../src/api/monarchHousehold');

const ACCOUNT_ID = 'monarch-acct-new';

const member = (overrides = {}) => ({
  id: 'user-1',
  name: 'Mykhailo Delegan',
  displayName: 'Mykhailo',
  householdRole: 'OWNER',
  profilePictureUrl: null,
  avatarColor: null,
  ...overrides,
});

const TWO_MEMBERS = [
  member(),
  member({ id: 'user-2', name: 'Liubov Monsar', displayName: 'Liubov' }),
];

const $ = (id) => document.getElementById(id);

/** Let queued microtasks (the awaited API calls) run */
const flush = async (times = 8) => {
  for (let i = 0; i < times; i += 1) {
    await Promise.resolve();
  }
};

/**
 * Open the dialog and wait for the modal to render.
 *
 * The dialog promise is returned **wrapped**, because an async function
 * returning it directly would adopt it and block until the user submits,
 * deadlocking the test.
 */
const openDialog = async (options = {}) => {
  const resultPromise = showAccountCreationDialog({
    defaultName: 'Rogers Mastercard',
    defaultType: 'credit',
    defaultSubtype: 'credit_card',
    defaultBalance: -1500.5,
    ...options,
  });

  await flush();

  return { resultPromise };
};

/** Submit the form and let the create chain settle */
const submitForm = async () => {
  const subtype = $('account-subtype');
  subtype.innerHTML = '<option value="credit_card">Credit Card</option>';
  subtype.value = 'credit_card';

  $('account-creation-form').dispatchEvent(new Event('submit', { cancelable: true }));

  await flush(20);
};

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();

  monarchApi.getAccountTypeOptions.mockResolvedValue([
    {
      type: {
        name: 'credit',
        display: 'Credit Card',
        possibleSubtypes: [{ name: 'credit_card', display: 'Credit Card' }],
      },
    },
  ]);
  monarchApi.createManualAccount.mockResolvedValue(ACCOUNT_ID);
  monarchApi.createManualInvestmentsAccount.mockResolvedValue(ACCOUNT_ID);
  monarchApi.listAccounts.mockResolvedValue([{ id: ACCOUNT_ID, displayName: 'Rogers Mastercard' }]);
  monarchApi.updateAccount.mockResolvedValue({
    id: ACCOUNT_ID,
    ownedByUser: { id: 'user-1', displayName: 'Mykhailo' },
  });
  getHouseholdMembers.mockResolvedValue({
    currentUserId: 'user-1',
    householdId: 'hh-1',
    members: TWO_MEMBERS,
  });
});

describe('capability gating', () => {
  it('shows the cardholder section when the integration supports cardholders', async () => {
    await openDialog({ supportsCardholders: true });

    expect($('cardholder-sync-section')).toBeTruthy();
    expect($('cardholder-owner-mode')).toBeTruthy();
    expect($('cardholder-tag-mode')).toBeTruthy();
  });

  it('omits the section entirely when the integration does not', async () => {
    // Wealthsimple, Questrade, CanadaLife: no cardholder name on transactions
    await openDialog({ supportsCardholders: false });

    expect($('cardholder-sync-section')).toBeNull();
    expect($('cardholder-owner-mode')).toBeNull();
    expect($('cardholder-tag-mode')).toBeNull();
  });

  it('omits the section when the flag is not passed at all', async () => {
    await openDialog();

    expect($('cardholder-sync-section')).toBeNull();
  });

  it('reports no cardholder settings when the section was not shown', async () => {
    // Absent rather than 'off', so the caller's mapping payload is untouched
    const { resultPromise } = await openDialog({ supportsCardholders: false });
    await submitForm();

    const account = await resultPromise;
    expect(account.cardholderOwnerMode).toBeUndefined();
    expect(account.cardholderTagMode).toBeUndefined();
  });
});

describe('defaults', () => {
  it('defaults owner mapping to off', async () => {
    await openDialog({ supportsCardholders: true });

    expect($('cardholder-owner-mode').checked).toBe(false);
  });

  it('defaults tagging to Off', async () => {
    await openDialog({ supportsCardholders: true });

    expect($('cardholder-tag-mode').value).toBe('off');
  });

  it('reports both as off when the user ignores the section', async () => {
    // The no-op path: identical behaviour to before the feature existed
    const { resultPromise } = await openDialog({ supportsCardholders: true });
    await submitForm();

    const account = await resultPromise;
    expect(account.cardholderOwnerMode).toBe('off');
    expect(account.cardholderTagMode).toBe('off');
  });

  it('offers exactly Off, Auto and Always for tagging', async () => {
    await openDialog({ supportsCardholders: true });

    const values = Array.from($('cardholder-tag-mode').options).map((o) => o.value);
    expect(values).toEqual(['off', 'auto', 'always']);
  });
});

describe('single-member households', () => {
  beforeEach(() => {
    getHouseholdMembers.mockResolvedValue({
      currentUserId: 'user-1', householdId: 'hh-1', members: [member()],
    });
  });

  it('disables the owner toggle', async () => {
    // Assigning every transaction to the only member is exactly what the
    // account-level owner already does
    await openDialog({ supportsCardholders: true });

    expect($('cardholder-owner-mode').disabled).toBe(true);
  });

  it('explains WHY the owner toggle is unavailable', async () => {
    await openDialog({ supportsCardholders: true });

    expect($('cardholder-owner-mode-hint').textContent).toContain('single-member');
  });

  it('keeps the tag control fully available', async () => {
    // Labelling who spent what is useful even with one household member
    await openDialog({ supportsCardholders: true });

    expect($('cardholder-tag-mode').disabled).toBe(false);
  });

  it('still lets the user choose a tag mode', async () => {
    const { resultPromise } = await openDialog({ supportsCardholders: true });

    $('cardholder-tag-mode').value = 'always';
    await submitForm();

    const account = await resultPromise;
    expect(account.cardholderTagMode).toBe('always');
  });

  it('reports owner mode as off even though the control was disabled', async () => {
    const { resultPromise } = await openDialog({ supportsCardholders: true });
    await submitForm();

    const account = await resultPromise;
    expect(account.cardholderOwnerMode).toBe('off');
  });

  it('also omits the account owner dropdown, which needs 2+ members too', async () => {
    await openDialog({ supportsCardholders: true });

    expect($('account-owner')).toBeNull();
  });
});

describe('multi-member households', () => {
  it('leaves the owner toggle enabled', async () => {
    await openDialog({ supportsCardholders: true });

    expect($('cardholder-owner-mode').disabled).toBe(false);
  });

  it('describes what the owner toggle does rather than why it is unavailable', async () => {
    await openDialog({ supportsCardholders: true });

    const hint = $('cardholder-owner-mode-hint').textContent;
    expect(hint).toContain('household member');
    expect(hint).not.toContain('Not available');
  });
});

describe('reporting the choices', () => {
  it('reports owner mapping on when the toggle is checked', async () => {
    const { resultPromise } = await openDialog({ supportsCardholders: true });

    $('cardholder-owner-mode').checked = true;
    await submitForm();

    const account = await resultPromise;
    expect(account.cardholderOwnerMode).toBe('on');
  });

  it('reports the selected tag mode', async () => {
    const { resultPromise } = await openDialog({ supportsCardholders: true });

    $('cardholder-tag-mode').value = 'auto';
    await submitForm();

    const account = await resultPromise;
    expect(account.cardholderTagMode).toBe('auto');
  });

  it('reports both settings together', async () => {
    const { resultPromise } = await openDialog({ supportsCardholders: true });

    $('cardholder-owner-mode').checked = true;
    $('cardholder-tag-mode').value = 'always';
    await submitForm();

    await expect(resultPromise).resolves.toMatchObject({
      cardholderOwnerMode: 'on',
      cardholderTagMode: 'always',
    });
  });

  it('does NOT write the settings itself — the caller persists them', async () => {
    // The dialog has no source account id, so persisting here is impossible.
    // updateAccount is only ever used for the Monarch account OWNER.
    const { resultPromise } = await openDialog({ supportsCardholders: true });

    $('cardholder-owner-mode').checked = true;
    await submitForm();
    await resultPromise;

    expect(monarchApi.updateAccount).not.toHaveBeenCalledWith(
      expect.objectContaining({ cardholderOwnerMode: expect.anything() }),
    );
  });

  it('reports the choices alongside the created account fields', async () => {
    const { resultPromise } = await openDialog({ supportsCardholders: true });

    $('cardholder-tag-mode').value = 'auto';
    await submitForm();

    await expect(resultPromise).resolves.toMatchObject({
      id: ACCOUNT_ID,
      newlyCreated: true,
      cardholderTagMode: 'auto',
    });
  });

  it('discards the choices when the dialog is cancelled', async () => {
    // No mapping is saved either, so there are no orphaned settings
    const { resultPromise } = await openDialog({ supportsCardholders: true });

    $('cardholder-owner-mode').checked = true;
    $('account-creation-cancel-button').click();

    await expect(resultPromise).resolves.toBeNull();
  });
});

describe('household fetch failure', () => {
  it('still shows the cardholder section', async () => {
    // Tagging does not depend on the household at all, so the section stays
    getHouseholdMembers.mockRejectedValue(new Error('network down'));

    await openDialog({ supportsCardholders: true });

    expect($('cardholder-sync-section')).toBeTruthy();
    expect($('cardholder-tag-mode').disabled).toBe(false);
  });

  it('disables owner mapping, since members could not be resolved', async () => {
    getHouseholdMembers.mockRejectedValue(new Error('network down'));

    await openDialog({ supportsCardholders: true });

    expect($('cardholder-owner-mode').disabled).toBe(true);
  });
});