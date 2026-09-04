/**
 * Tests for the reusable Cardholders settings widget
 *
 * The widget is capability-driven so it renders identically for legacy tabs
 * (Rogers Bank) and modular tabs (MBNA). It must remain usable when the Monarch
 * household fetch fails, so persisted mappings stay visible and editable.
 */

import { renderCardholderMappingsSection } from '../../src/ui/components/settingsModalCardholders';

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

jest.mock('../../src/core/integrationCapabilities', () => ({
  ACCOUNT_SETTINGS: {
    CARDHOLDER_OWNER_MODE: 'cardholderOwnerMode',
    CARDHOLDER_TAG_MODE: 'cardholderTagMode',
  },
  hasCapability: jest.fn(() => true),
}));

jest.mock('../../src/services/common/accountService', () => ({
  __esModule: true,
  default: {
    getAccountData: jest.fn(() => ({})),
    updateAccountInList: jest.fn(() => true),
  },
}));

jest.mock('../../src/api/monarchHousehold', () => ({
  getHouseholdMembers: jest.fn(() => Promise.resolve({ currentUserId: 'user-1', householdId: 'hh-1', members: [] })),
}));

jest.mock('../../src/services/common/cardholderMatching', () => ({
  describeMatchType: jest.fn((t) => `described:${t}`),
}));

jest.mock('../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

// Minimal stand-in for the shared toggle switch: a checkbox that invokes the
// change handler, which is all this widget depends on. `globalThis.document` is
// used because jest.mock factories may not close over outer-scope variables.
jest.mock('../../src/ui/components/settingsModalHelpers', () => ({
  createToggleSwitch: jest.fn((isEnabled, onChange) => {
    const input = globalThis.document.createElement('input');
    input.type = 'checkbox';
    input.checked = isEnabled;
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }),
}));

const { hasCapability } = require('../../src/core/integrationCapabilities');
const accountService = require('../../src/services/common/accountService').default;
const { getHouseholdMembers } = require('../../src/api/monarchHousehold');
const toast = require('../../src/ui/toast').default;

const INTEGRATION = 'rogersbank';
const ACCOUNT_ID = 'acc-1';

const entry = (overrides = {}) => ({
  label: 'Mykhailo Delegan',
  cardLast4: '8584',
  firstSeen: '2026-09-04',
  monarchUserId: null,
  monarchUserName: null,
  isShared: false,
  matchType: 'unresolved',
  ...overrides,
});

const member = (overrides = {}) => ({
  id: 'user-1',
  name: 'Mykhailo Delegan',
  displayName: 'Mykhailo',
  householdRole: 'OWNER',
  profilePictureUrl: null,
  avatarColor: null,
  ...overrides,
});

/** Render the section into the document so getElementById works */
const render = (accountEntry = {}, onRefresh = null) => {
  const section = renderCardholderMappingsSection(INTEGRATION, accountEntry, ACCOUNT_ID, onRefresh);
  document.body.appendChild(section);
  return section;
};

const $ = (id) => document.getElementById(id);

/** Let the lazily-resolved household fetch settle */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

beforeEach(() => {
  document.body.innerHTML = '';
  jest.clearAllMocks();
  hasCapability.mockReturnValue(true);
  accountService.getAccountData.mockReturnValue({});
  accountService.updateAccountInList.mockReturnValue(true);
  getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [] });
});

describe('capability gating', () => {
  it('renders an empty element when the integration has no cardholder capability', () => {
    hasCapability.mockReturnValue(false);

    const section = render({});

    expect(section.children).toHaveLength(0);
  });

  it('renders the section when the capability is present', () => {
    render({});

    expect($(`cardholders-section-${INTEGRATION}-${ACCOUNT_ID}`)).toBeTruthy();
  });
});

describe('mode selectors', () => {
  it('renders both mode selectors', () => {
    render({});

    expect($(`cardholder-owner-mode-${ACCOUNT_ID}`)).toBeTruthy();
    expect($(`cardholder-tag-mode-${ACCOUNT_ID}`)).toBeTruthy();
  });

  it('renders the owner mode as a toggle rather than a dropdown', () => {
    render({});

    const toggle = $(`cardholder-owner-mode-${ACCOUNT_ID}-toggle`);
    expect(toggle).toBeTruthy();
    expect(toggle.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect($(`cardholder-owner-mode-${ACCOUNT_ID}-select`)).toBeNull();
  });

  it('defaults the owner mode toggle to off', () => {
    render({});

    expect($(`cardholder-owner-mode-${ACCOUNT_ID}-toggle`).querySelector('input').checked).toBe(false);
  });

  it('defaults the tag mode to off', () => {
    render({});

    expect($(`cardholder-tag-mode-${ACCOUNT_ID}-select`).value).toBe('off');
  });

  it('reflects the persisted owner mode in the toggle', () => {
    render({ cardholderOwnerMode: 'on' });

    expect($(`cardholder-owner-mode-${ACCOUNT_ID}-toggle`).querySelector('input').checked).toBe(true);
  });

  it('offers off/auto/always for the tag mode', () => {
    render({});

    const values = Array.from($(`cardholder-tag-mode-${ACCOUNT_ID}-select`).options).map((o) => o.value);
    expect(values).toEqual(['off', 'auto', 'always']);
  });

  it('persists enabling owner mapping via the toggle', () => {
    render({});

    const input = $(`cardholder-owner-mode-${ACCOUNT_ID}-toggle`).querySelector('input');
    input.checked = true;
    input.dispatchEvent(new Event('change'));

    expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT_ID, {
      cardholderOwnerMode: 'on',
    });
  });

  it('persists disabling owner mapping via the toggle', () => {
    render({ cardholderOwnerMode: 'on' });

    const input = $(`cardholder-owner-mode-${ACCOUNT_ID}-toggle`).querySelector('input');
    input.checked = false;
    input.dispatchEvent(new Event('change'));

    expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT_ID, {
      cardholderOwnerMode: 'off',
    });
  });

  it('persists a tag mode change', () => {
    render({});

    const select = $(`cardholder-tag-mode-${ACCOUNT_ID}-select`);
    select.value = 'always';
    select.dispatchEvent(new Event('change'));

    expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT_ID, {
      cardholderTagMode: 'always',
    });
  });

  it('surfaces an error toast when persisting fails', () => {
    accountService.updateAccountInList.mockReturnValue(false);
    render({});

    const select = $(`cardholder-tag-mode-${ACCOUNT_ID}-select`);
    select.value = 'auto';
    select.dispatchEvent(new Event('change'));

    expect(toast.show).toHaveBeenCalledWith('Failed to update setting', 'error');
  });
});

describe('cardholder mapping header', () => {
  it('labels the detected-cardholder list', () => {
    render({ cardholders: { 'MYKHAILO DELEGAN': entry() } });

    expect($(`cardholders-list-header-${INTEGRATION}-${ACCOUNT_ID}`).textContent)
      .toBe('Cardholder mapping');
  });

  it('describes what the list contains', () => {
    render({ cardholders: { 'MYKHAILO DELEGAN': entry() } });

    expect($(`cardholders-list-header-desc-${INTEGRATION}-${ACCOUNT_ID}`).textContent)
      .toContain('detected on this account');
  });

  it('is shown even when no cardholders have been detected yet', () => {
    render({});

    expect($(`cardholders-list-header-${INTEGRATION}-${ACCOUNT_ID}`)).toBeTruthy();
  });
});

describe('empty state', () => {
  it('explains that cardholders are discovered during sync', () => {
    render({});

    const empty = $(`cardholders-empty-${INTEGRATION}-${ACCOUNT_ID}`);
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('discovered automatically during sync');
  });

  it('does not fetch household members when there are no cardholders', () => {
    render({ cardholderOwnerMode: 'on' });

    expect(getHouseholdMembers).not.toHaveBeenCalled();
  });
});

describe('cardholder rows', () => {
  const withOneCardholder = { cardholders: { 'MYKHAILO DELEGAN': entry() } };

  it('renders a row per discovered cardholder', () => {
    render({
      cardholders: {
        'MYKHAILO DELEGAN': entry(),
        'LIUBOV MONSAR': entry({ label: 'Liubov Monsar', cardLast4: '2142' }),
      },
    });

    expect($('cardholder-row-8584')).toBeTruthy();
    expect($('cardholder-row-2142')).toBeTruthy();
  });

  it('shows the raw cardholder name and card metadata', () => {
    render(withOneCardholder);

    const info = $('cardholder-info-8584');
    expect(info.textContent).toContain('MYKHAILO DELEGAN');
    expect(info.textContent).toContain('card ••8584');
    expect(info.textContent).toContain('first seen 2026-09-04');
  });

  it('renders an editable label input seeded with the stored label', () => {
    render(withOneCardholder);

    expect($('cardholder-label-input-8584').value).toBe('Mykhailo Delegan');
  });

  it('persists a label change', () => {
    accountService.getAccountData.mockReturnValue(withOneCardholder);
    render(withOneCardholder);

    const input = $('cardholder-label-input-8584');
    input.value = 'Mike';
    input.dispatchEvent(new Event('change'));

    expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT_ID, {
      cardholders: expect.objectContaining({
        'MYKHAILO DELEGAN': expect.objectContaining({ label: 'Mike' }),
      }),
    });
  });

  it('rejects an empty label and restores the previous value', () => {
    accountService.getAccountData.mockReturnValue(withOneCardholder);
    render(withOneCardholder);

    const input = $('cardholder-label-input-8584');
    input.value = '   ';
    input.dispatchEvent(new Event('change'));

    expect(input.value).toBe('Mykhailo Delegan');
    expect(toast.show).toHaveBeenCalledWith('Tag label cannot be empty', 'error');
    expect(accountService.updateAccountInList).not.toHaveBeenCalled();
  });

  describe('match badges', () => {
    it('shows Manual for a manually mapped cardholder', () => {
      render({
        cardholders: {
          A: entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan', matchType: 'manual' }),
        },
      });

      expect($('cardholder-row-8584').textContent).toContain('Manual');
    });

    it('shows Auto for an automatically matched cardholder', () => {
      render({
        cardholders: {
          A: entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan', matchType: 'exact-name' }),
        },
      });

      expect($('cardholder-row-8584').textContent).toContain('Auto');
    });

    it('shows Shared for an explicitly Shared cardholder', () => {
      render({ cardholders: { A: entry({ isShared: true, matchType: 'manual' }) } });

      expect($('cardholder-row-8584').textContent).toContain('Shared');
    });

    it('shows Not mapped for an unresolved cardholder', () => {
      render({ cardholders: { A: entry() } });

      expect($('cardholder-row-8584').textContent).toContain('Not mapped');
    });
  });

  describe('member dropdown', () => {
    it('is not rendered while owner mapping is off', async () => {
      render({ ...withOneCardholder, cardholderOwnerMode: 'off' });
      await flush();

      expect($('cardholder-member-select-8584')).toBeNull();
    });

    it('is rendered with Shared plus every member once owner mapping is on', async () => {
      getHouseholdMembers.mockResolvedValue({
        currentUserId: 'user-1',
        householdId: 'hh-1',
        members: [member(), member({ id: 'user-2', name: 'Liubov Monsar' })],
      });

      render({ ...withOneCardholder, cardholderOwnerMode: 'on' });
      await flush();

      const select = $('cardholder-member-select-8584');
      expect(Array.from(select.options).map((o) => o.textContent))
        .toEqual(['Shared', 'Mykhailo Delegan', 'Liubov Monsar']);
    });

    it('pre-selects the currently mapped member', async () => {
      getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [member()] });

      render({
        cardholderOwnerMode: 'on',
        cardholders: {
          'MYKHAILO DELEGAN': entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan' }),
        },
      });
      await flush();

      expect($('cardholder-member-select-8584').value).toBe('user-1');
    });

    it('pre-selects Shared for an unmapped cardholder', async () => {
      getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [member()] });

      render({ ...withOneCardholder, cardholderOwnerMode: 'on' });
      await flush();

      expect($('cardholder-member-select-8584').value).toBe('__shared__');
    });

    it('persists a member selection as a manual mapping', async () => {
      getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [member()] });
      accountService.getAccountData.mockReturnValue(withOneCardholder);

      render({ ...withOneCardholder, cardholderOwnerMode: 'on' });
      await flush();

      const select = $('cardholder-member-select-8584');
      select.value = 'user-1';
      select.dispatchEvent(new Event('change'));

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT_ID, {
        cardholders: expect.objectContaining({
          'MYKHAILO DELEGAN': expect.objectContaining({
            monarchUserId: 'user-1',
            monarchUserName: 'Mykhailo Delegan',
            isShared: false,
            matchType: 'manual',
          }),
        }),
      });
    });

    it('persists a Shared selection as a manual mapping', async () => {
      getHouseholdMembers.mockResolvedValue({ currentUserId: 'user-1', householdId: 'hh-1', members: [member()] });
      accountService.getAccountData.mockReturnValue({
        cardholders: {
          'MYKHAILO DELEGAN': entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan' }),
        },
      });

      render({
        cardholderOwnerMode: 'on',
        cardholders: {
          'MYKHAILO DELEGAN': entry({ monarchUserId: 'user-1', monarchUserName: 'Mykhailo Delegan' }),
        },
      });
      await flush();

      const select = $('cardholder-member-select-8584');
      select.value = '__shared__';
      select.dispatchEvent(new Event('change'));

      expect(accountService.updateAccountInList).toHaveBeenCalledWith(INTEGRATION, ACCOUNT_ID, {
        cardholders: expect.objectContaining({
          'MYKHAILO DELEGAN': expect.objectContaining({
            monarchUserId: null,
            monarchUserName: null,
            isShared: true,
            matchType: 'manual',
          }),
        }),
      });
    });
  });

  describe('household fetch failure', () => {
    it('keeps existing cardholder rows visible', async () => {
      getHouseholdMembers.mockRejectedValue(new Error('network down'));

      render({ ...withOneCardholder, cardholderOwnerMode: 'on' });
      await flush();

      expect($('cardholder-row-8584')).toBeTruthy();
      expect($('cardholder-info-8584').textContent).toContain('MYKHAILO DELEGAN');
    });

    it('explains that members could not be loaded instead of showing a dropdown', async () => {
      getHouseholdMembers.mockRejectedValue(new Error('network down'));

      render({ ...withOneCardholder, cardholderOwnerMode: 'on' });
      await flush();

      expect($('cardholder-member-select-8584')).toBeNull();
      expect($('cardholder-row-8584').textContent).toContain('Members unavailable');
    });
  });
});