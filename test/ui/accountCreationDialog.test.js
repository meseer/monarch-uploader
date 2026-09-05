/**
 * Tests for the account owner selector in the account creation dialog
 *
 * Monarch's create mutation has no owner field, so choosing a member means a
 * follow-up `updateAccount({ ownerUserId })`. Shared is Monarch's own default
 * for a new account, so it needs no call at all.
 *
 * The properties worth protecting:
 *
 * - Shared is pre-selected, and selecting it issues NO update call
 * - a chosen member is applied and verified against the returned ownedByUser
 * - a failure to set the owner never loses the account the user just created
 * - the dropdown is omitted when there is nothing to choose (solo household,
 *   or the household could not be fetched)
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
const toast = require('../../src/ui/toast').default;
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
 * Returns the dialog promise **wrapped in an object**, which is load-bearing: an
 * async function returning a promise directly would *adopt* it, so
 * `await openDialog()` would block until the user submits — deadlocking every
 * test. Wrapping keeps it awaitable only where a test actually wants the result.
 */
const openDialog = async (options = {}) => {
  const resultPromise = showAccountCreationDialog({
    defaultName: 'Rogers Mastercard',
    defaultType: 'credit',
    defaultSubtype: 'credit_card',
    defaultBalance: -1500.5,
    ...options,
  });

  // Two awaited fetches (account types, household) precede the render
  await flush();

  return { resultPromise };
};

/** Submit the form and let the create → owner → listAccounts chain settle */
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

describe('owner dropdown rendering', () => {
  it('renders the owner selector for a multi-member household', async () => {
    await openDialog();

    expect($('account-owner-group')).toBeTruthy();
    expect($('account-owner')).toBeTruthy();
    expect($('account-owner-label').textContent).toBe('Account Owner:');
  });

  it('pre-selects Shared, matching Monarch default for a new account', async () => {
    await openDialog();

    expect($('account-owner').value).toBe('');
    expect($('account-owner').options[0].textContent).toBe('Shared');
    expect($('account-owner').options[0].selected).toBe(true);
  });

  it('lists Shared plus every household member', async () => {
    await openDialog();

    const labels = Array.from($('account-owner').options).map((o) => o.textContent);
    expect(labels).toEqual(['Shared', 'Liubov', 'Mykhailo']);
  });

  it('uses the member id as the option value', async () => {
    await openDialog();

    const byLabel = Array.from($('account-owner').options)
      .reduce((acc, o) => ({ ...acc, [o.textContent]: o.value }), {});

    expect(byLabel.Mykhailo).toBe('user-1');
    expect(byLabel.Liubov).toBe('user-2');
  });

  it('sorts members alphabetically', async () => {
    await openDialog();

    const memberLabels = Array.from($('account-owner').options).slice(1).map((o) => o.textContent);
    expect(memberLabels).toEqual([...memberLabels].sort());
  });

  it('explains that transactions inherit the account owner', async () => {
    await openDialog();

    expect($('account-owner-hint').textContent).toContain('inherit');
  });

  it('places the owner selector after the subtype field', async () => {
    await openDialog();

    const groups = Array.from($('account-creation-form').children).map((el) => el.id);
    expect(groups.indexOf('account-owner-group'))
      .toBeGreaterThan(groups.indexOf('account-subtype-group'));
  });
});

describe('owner dropdown is omitted when there is nothing to choose', () => {
  it('omits it for a single-member household', async () => {
    getHouseholdMembers.mockResolvedValue({
      currentUserId: 'user-1', householdId: 'hh-1', members: [member()],
    });

    await openDialog();

    expect($('account-owner')).toBeNull();
  });

  it('omits it when the household has no members', async () => {
    getHouseholdMembers.mockResolvedValue({ currentUserId: null, householdId: null, members: [] });

    await openDialog();

    expect($('account-owner')).toBeNull();
  });

  it('omits it when the household fetch fails, without blocking creation', async () => {
    // Creating the account is the user's goal; losing the owner field is a far
    // better outcome than refusing to create the account at all.
    getHouseholdMembers.mockRejectedValue(new Error('network down'));

    await openDialog();

    expect($('account-owner')).toBeNull();
    expect($('account-creation-modal')).toBeTruthy();
    expect($('account-creation-create-button')).toBeTruthy();
  });
});

describe('applying the chosen owner', () => {
  it('issues NO update call when Shared is selected', async () => {
    // Shared is already Monarch's default (ownerUserId: null), so a call would
    // be pure overhead.
    await openDialog();

    await submitForm();

    expect(monarchApi.createManualAccount).toHaveBeenCalled();
    expect(monarchApi.updateAccount).not.toHaveBeenCalled();
  });

  it('assigns the owner when a member is selected', async () => {
    await openDialog();

    $('account-owner').value = 'user-1';
    await submitForm();

    expect(monarchApi.updateAccount).toHaveBeenCalledWith({
      id: ACCOUNT_ID,
      ownerUserId: 'user-1',
    });
  });

  it('assigns the owner AFTER the account exists', async () => {
    // The create mutation cannot carry an owner, so ordering is not incidental
    const order = [];
    monarchApi.createManualAccount.mockImplementation(async () => {
      order.push('create');
      return ACCOUNT_ID;
    });
    monarchApi.updateAccount.mockImplementation(async () => {
      order.push('update');
      return { id: ACCOUNT_ID, ownedByUser: { id: 'user-1' } };
    });

    await openDialog();
    $('account-owner').value = 'user-1';
    await submitForm();

    expect(order).toEqual(['create', 'update']);
  });

  it('still resolves with the created account when the owner update fails', async () => {
    monarchApi.updateAccount.mockRejectedValue(new Error('permission denied'));

    const { resultPromise } = await openDialog();
    $('account-owner').value = 'user-1';
    await submitForm();

    await expect(resultPromise).resolves.toMatchObject({ id: ACCOUNT_ID, newlyCreated: true });
  });

  it('warns the user when the owner could not be set', async () => {
    monarchApi.updateAccount.mockRejectedValue(new Error('permission denied'));

    await openDialog();
    $('account-owner').value = 'user-1';
    await submitForm();

    expect(toast.show).toHaveBeenCalledWith(
      expect.stringContaining('owner could not be set'),
      'warning',
    );
  });

  it('warns when the update succeeds but the owner did not stick', async () => {
    // updateAccount reports field errors in its payload rather than rejecting,
    // so the returned owner is verified rather than assumed.
    monarchApi.updateAccount.mockResolvedValue({ id: ACCOUNT_ID, ownedByUser: null });

    await openDialog();
    $('account-owner').value = 'user-1';
    await submitForm();

    expect(toast.show).toHaveBeenCalledWith(
      expect.stringContaining('owner could not be set'),
      'warning',
    );
  });

  it('does not warn when the owner was applied successfully', async () => {
    await openDialog();
    $('account-owner').value = 'user-1';
    await submitForm();

    expect(toast.show).not.toHaveBeenCalledWith(
      expect.stringContaining('owner could not be set'),
      'warning',
    );
  });

  it('issues no update call when the dropdown was never rendered', async () => {
    getHouseholdMembers.mockResolvedValue({ currentUserId: 'u', householdId: 'h', members: [member()] });

    await openDialog();
    await submitForm();

    expect(monarchApi.updateAccount).not.toHaveBeenCalled();
  });
});

describe('existing dialog behaviour is preserved', () => {
  it('still creates the account with the expected fields', async () => {
    await openDialog();

    await submitForm();

    expect(monarchApi.createManualAccount).toHaveBeenCalledWith(expect.objectContaining({
      type: 'credit',
      subtype: 'credit_card',
      name: 'Rogers Mastercard',
    }));
  });

  it('keeps the owner selector in holdings mode, where balance and net worth are hidden', async () => {
    // Holdings accounts use a different creation mutation, but ownership applies
    // to any account type, so the selector stays.
    await openDialog({ trackingMethod: 'holdings' });

    expect($('account-balance')).toBeNull();
    expect($('account-net-worth')).toBeNull();
    expect($('account-owner')).toBeTruthy();
  });
});