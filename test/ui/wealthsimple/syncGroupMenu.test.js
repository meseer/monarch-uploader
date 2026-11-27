/**
 * @vitest-environment jsdom
 *
 * The bulk "Sync All to Monarch" button is a split button: its chevron half
 * opens a menu that syncs a single account group.
 */

vi.mock('../../../src/api/wealthsimple', () => ({
  default: {
    checkAuth: vi.fn(() => ({ authenticated: true, expiresAt: '2099-01-01T00:00:00Z' })),
    fetchAccountBalances: vi.fn(async () => ({
      success: true,
      balances: new Map([
        ['acct-a', { balance: 100 }],
        ['acct-b', { balance: 200 }],
      ]),
    })),
  },
}));

vi.mock('../../../src/services/wealthsimple-upload', () => ({
  uploadAllWealthsimpleAccountsToMonarch: vi.fn(async () => ({ success: 2 })),
  uploadWealthsimpleAccountToMonarchWithSteps: vi.fn(async () => ({ success: true })),
  buildSyncStepsForAccount: vi.fn(() => []),
}));

vi.mock('../../../src/services/wealthsimple/account', () => ({
  syncAccountListWithAPI: vi.fn(async () => [
    { wealthsimpleAccount: { id: 'acct-a', nickname: 'Chequing A' } },
    { wealthsimpleAccount: { id: 'acct-b', nickname: 'Chequing B' } },
  ]),
}));

vi.mock('../../../src/services/wealthsimple/balance', () => ({
  getDefaultDateRange: vi.fn(() => ({ fromDate: '2026-01-01', toDate: '2026-01-31' })),
}));

vi.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: vi.fn(async () => true),
  createMonarchLoginLink: vi.fn(() => globalThis.document.createElement('a')),
}));

vi.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: vi.fn(() => ({
    onCancel: vi.fn(),
    updateProgress: vi.fn(),
    initSteps: vi.fn(),
    showSummary: vi.fn(),
    hideCancel: vi.fn(),
  })),
}));

vi.mock('../../../src/ui/toast', () => ({
  default: { show: vi.fn() },
}));

global.GM_getValue = vi.fn();
global.GM_setValue = vi.fn();

import { createWealthsimpleUploadButton } from '../../../src/ui/wealthsimple/components/uploadButton';
import {
  uploadAllWealthsimpleAccountsToMonarch,
} from '../../../src/services/wealthsimple-upload';
import { ensureMonarchAuthentication } from '../../../src/ui/components/monarchLoginLink';
import toast from '../../../src/ui/toast';

/** Let the async click handler run to completion. */
async function flushAsync() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function render(path = '/app/home') {
  window.history.pushState({}, '', path);
  document.body.innerHTML = '';
  document.body.appendChild(createWealthsimpleUploadButton());
}

const byId = (id) => document.getElementById(id);
const toggle = () => byId('wealthsimple-sync-group-toggle-button');
const menu = () => byId('wealthsimple-sync-group-menu');
const isMenuOpen = () => menu() !== null;

describe('Wealthsimple sync group split button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    test('splits the bulk sync button on the home page', () => {
      render();

      const split = byId('wealthsimple-upload-split-button');
      expect(split).not.toBeNull();
      expect(split.contains(byId('wealthsimple-upload-button'))).toBe(true);
      expect(split.contains(toggle())).toBe(true);
      expect(toggle().getAttribute('aria-haspopup')).toBe('menu');
      expect(isMenuOpen()).toBe(false);
    });

    test('draws the chevron as a centred SVG icon rather than a text glyph', () => {
      render();

      const icon = byId('wealthsimple-sync-group-toggle-icon');
      expect(icon.tagName.toLowerCase()).toBe('svg');
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(toggle().textContent).toBe('');
      expect(toggle().style.display).toBe('inline-flex');
      expect(toggle().style.alignItems).toBe('center');
      expect(toggle().style.justifyContent).toBe('center');
    });

    test('separates the halves with a gap instead of a divider line', () => {
      render();

      expect(byId('wealthsimple-upload-split-button').style.gap).toBe('2px');
      expect(toggle().style.borderLeft).not.toContain('solid');
    });

    test('lists Spend & Save and Investing, in that order', () => {
      render();
      toggle().click();

      const items = Array.from(menu().querySelectorAll('[role="menuitem"]'));
      expect(items.map((item) => item.id)).toEqual([
        'wealthsimple-sync-group-item-spend-save',
        'wealthsimple-sync-group-item-investing',
      ]);
      expect(byId('wealthsimple-sync-group-label-spend-save').textContent).toBe('Sync Spend & Save only');
      expect(byId('wealthsimple-sync-group-description-spend-save').textContent).toContain('credit card');
      expect(byId('wealthsimple-sync-group-description-investing').textContent).toContain('crypto');
    });

    test('keeps a single plain button on an account page', () => {
      render('/app/account-details/acct-a');

      expect(byId('wealthsimple-upload-button').textContent).toBe('Sync to Monarch');
      expect(toggle()).toBeNull();
      expect(menu()).toBeNull();
      expect(byId('wealthsimple-upload-split-button')).toBeNull();
    });
  });

  describe('opening and closing', () => {
    test('opens in document.body, outside the card that would clip it', () => {
      render();

      toggle().click();

      expect(menu().parentElement).toBe(document.body);
      expect(byId('wealthsimple-upload-split-button').contains(menu())).toBe(false);
      expect(menu().style.position).toBe('fixed');
    });

    test('rotates the chevron while open', () => {
      render();
      const icon = byId('wealthsimple-sync-group-toggle-icon');

      toggle().click();
      expect(icon.style.transform).toBe('rotate(180deg)');

      toggle().click();
      expect(icon.style.transform).toBe('');
    });

    test('scrolling or resizing closes the menu', () => {
      render();

      toggle().click();
      window.dispatchEvent(new Event('scroll'));
      expect(isMenuOpen()).toBe(false);

      toggle().click();
      window.dispatchEvent(new Event('resize'));
      expect(isMenuOpen()).toBe(false);
    });

    test('clicks inside the menu do not close it', () => {
      render();
      toggle().click();

      byId('wealthsimple-sync-group-description-investing').dispatchEvent(new MouseEvent('click', { bubbles: false }));

      expect(isMenuOpen()).toBe(true);
    });

    test('toggle opens and closes the menu', () => {
      render();

      toggle().click();
      expect(isMenuOpen()).toBe(true);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');

      toggle().click();
      expect(isMenuOpen()).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    test('clicking outside closes the menu', () => {
      render();
      toggle().click();

      document.body.click();

      expect(isMenuOpen()).toBe(false);
    });

    test('Escape closes the menu', () => {
      render();
      toggle().click();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(isMenuOpen()).toBe(false);
    });

    test('other keys leave the menu open', () => {
      render();
      toggle().click();

      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(isMenuOpen()).toBe(true);
    });
  });

  describe('syncing a group', () => {
    test.each([
      ['wealthsimple-sync-group-item-spend-save', 'spendSave'],
      ['wealthsimple-sync-group-item-investing', 'investing'],
    ])('%s syncs only the %s group', async (itemId, group) => {
      render();
      toggle().click();

      byId(itemId).click();
      await flushAsync();

      expect(isMenuOpen()).toBe(false);
      expect(uploadAllWealthsimpleAccountsToMonarch).toHaveBeenCalledTimes(1);
      expect(uploadAllWealthsimpleAccountsToMonarch).toHaveBeenCalledWith(group);
    });

    test('the main button still syncs every account', async () => {
      render();

      byId('wealthsimple-upload-button').click();
      await flushAsync();

      expect(uploadAllWealthsimpleAccountsToMonarch).toHaveBeenCalledWith(null);
    });

    test('disables both halves and names the group while syncing', async () => {
      let finish;
      uploadAllWealthsimpleAccountsToMonarch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      render();
      toggle().click();

      byId('wealthsimple-sync-group-item-investing').click();
      await flushAsync();

      const button = byId('wealthsimple-upload-button');
      expect(button.disabled).toBe(true);
      expect(button.textContent).toBe('Syncing Investing...');
      expect(toggle().disabled).toBe(true);

      // A disabled toggle does not reopen the menu
      toggle().click();
      expect(isMenuOpen()).toBe(false);

      finish();
      await flushAsync();

      expect(button.disabled).toBe(false);
      expect(button.textContent).toBe('Sync All to Monarch');
      expect(toggle().disabled).toBe(false);
    });

    test('does not sync when Monarch sign-in is cancelled', async () => {
      ensureMonarchAuthentication.mockResolvedValueOnce(false);
      render();
      toggle().click();

      byId('wealthsimple-sync-group-item-spend-save').click();
      await flushAsync();

      expect(uploadAllWealthsimpleAccountsToMonarch).not.toHaveBeenCalled();
    });

    test('shows a toast and re-enables the button when the group sync throws', async () => {
      uploadAllWealthsimpleAccountsToMonarch.mockRejectedValueOnce(new Error('boom'));
      render();
      toggle().click();

      byId('wealthsimple-sync-group-item-spend-save').click();
      await flushAsync();

      expect(toast.show).toHaveBeenCalledWith('Sync failed: boom', 'error');
      expect(byId('wealthsimple-upload-button').disabled).toBe(false);
      expect(toggle().disabled).toBe(false);
    });
  });

  describe('placement', () => {
    function stubLayout({ anchor, menuSize = { width: 260, height: 120 }, viewport = { width: 1200, height: 800 } }) {
      vi.spyOn(byId('wealthsimple-upload-split-button'), 'getBoundingClientRect').mockReturnValue(anchor);
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(menuSize.height);
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(menuSize.width);
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(viewport.height);
      vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewport.width);
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    test('opens below the split button, left-aligned with it', () => {
      render();
      stubLayout({ anchor: { top: 100, bottom: 142, left: 300, right: 500 } });

      toggle().click();

      expect(menu().style.top).toBe('146px');
      expect(menu().style.left).toBe('300px');
    });

    test('flips above the button when there is no room below', () => {
      render();
      stubLayout({ anchor: { top: 700, bottom: 742, left: 300, right: 500 } });

      toggle().click();

      expect(menu().style.top).toBe(`${700 - 120 - 4}px`);
    });

    test('stays inside the viewport near the right edge', () => {
      render();
      stubLayout({ anchor: { top: 100, bottom: 142, left: 1100, right: 1190 } });

      toggle().click();

      expect(menu().style.left).toBe(`${1200 - 260 - 4}px`);
    });
  });
});
