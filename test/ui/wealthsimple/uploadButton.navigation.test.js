/**
 * @jest-environment jsdom
 *
 * The uploader card survives Wealthsimple's SPA navigation, so the sync button
 * must resolve its target account when clicked rather than when it was built.
 */

jest.mock('../../../src/api/wealthsimple', () => ({
  __esModule: true,
  default: {
    checkAuth: jest.fn(() => ({ authenticated: true, expiresAt: '2099-01-01T00:00:00Z' })),
    fetchAccountBalances: jest.fn(async () => ({
      success: true,
      balances: new Map([
        ['acct-a', { balance: 100 }],
        ['acct-b', { balance: 200 }],
      ]),
    })),
  },
}));

jest.mock('../../../src/services/wealthsimple-upload', () => ({
  uploadAllWealthsimpleAccountsToMonarch: jest.fn(async () => ({ success: 2 })),
  uploadWealthsimpleAccountToMonarchWithSteps: jest.fn(async () => ({ success: true })),
  buildSyncStepsForAccount: jest.fn(() => []),
}));

jest.mock('../../../src/services/wealthsimple/account', () => ({
  syncAccountListWithAPI: jest.fn(async () => [
    { wealthsimpleAccount: { id: 'acct-a', nickname: 'Chequing A' } },
    { wealthsimpleAccount: { id: 'acct-b', nickname: 'Chequing B' } },
  ]),
}));

jest.mock('../../../src/services/wealthsimple/balance', () => ({
  getDefaultDateRange: jest.fn(() => ({ fromDate: '2026-01-01', toDate: '2026-01-31' })),
}));

jest.mock('../../../src/ui/components/monarchLoginLink', () => ({
  ensureMonarchAuthentication: jest.fn(async () => true),
  createMonarchLoginLink: jest.fn(() => globalThis.document.createElement('a')),
}));

jest.mock('../../../src/ui/components/progressDialog', () => ({
  showProgressDialog: jest.fn(() => ({
    onCancel: jest.fn(),
    updateProgress: jest.fn(),
    initSteps: jest.fn(),
    showSummary: jest.fn(),
    hideCancel: jest.fn(),
  })),
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

global.GM_getValue = jest.fn();
global.GM_setValue = jest.fn();

import { createWealthsimpleUploadButton } from '../../../src/ui/wealthsimple/components/uploadButton';
import {
  uploadAllWealthsimpleAccountsToMonarch,
  uploadWealthsimpleAccountToMonarchWithSteps,
} from '../../../src/services/wealthsimple-upload';

/** Let the async click handler run to completion. */
async function flushAsync() {
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function navigateTo(path) {
  window.history.pushState({}, '', path);
}

function renderButton() {
  document.body.innerHTML = '';
  const container = createWealthsimpleUploadButton();
  document.body.appendChild(container);
  return document.getElementById('wealthsimple-upload-button');
}

function syncedAccountIds() {
  return uploadWealthsimpleAccountToMonarchWithSteps.mock.calls
    .map(([consolidatedAccount]) => consolidatedAccount.wealthsimpleAccount.id);
}

describe('Wealthsimple upload button target resolution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigateTo('/app/home');
    document.body.innerHTML = '';
  });

  test('syncs the account whose page is open when built', async () => {
    navigateTo('/app/account-details/acct-a');
    const button = renderButton();

    button.click();
    await flushAsync();

    expect(syncedAccountIds()).toEqual(['acct-a']);
  });

  test('syncs the newly opened account after account -> account navigation', async () => {
    navigateTo('/app/account-details/acct-a');
    const button = renderButton();

    // Wealthsimple navigates without our card (or this button) being recreated.
    navigateTo('/app/account-details/acct-b');
    button.click();
    await flushAsync();

    expect(syncedAccountIds()).toEqual(['acct-b']);
    expect(syncedAccountIds()).not.toContain('acct-a');
  });

  test('falls back to a bulk sync when navigating from an account page to home', async () => {
    navigateTo('/app/account-details/acct-a');
    const button = renderButton();

    navigateTo('/app/home');
    button.click();
    await flushAsync();

    expect(uploadAllWealthsimpleAccountsToMonarch).toHaveBeenCalledTimes(1);
    expect(uploadWealthsimpleAccountToMonarchWithSteps).not.toHaveBeenCalled();
  });

  test('bulk syncs on the home page and relabels the button afterwards', async () => {
    const button = renderButton();
    expect(button.textContent).toBe('Sync All to Monarch');

    button.click();
    await flushAsync();

    expect(uploadAllWealthsimpleAccountsToMonarch).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe('Sync All to Monarch');
  });

  test('relabels to the single account wording after a bulk sync that ends on an account page', async () => {
    const button = renderButton();

    uploadAllWealthsimpleAccountsToMonarch.mockImplementationOnce(async () => {
      navigateTo('/app/account-details/acct-b');
      return { success: 2 };
    });

    button.click();
    await flushAsync();

    expect(button.textContent).toBe('Sync to Monarch');
  });

  test('labels the button for the account page it is built on', () => {
    navigateTo('/app/account-details/acct-a');

    expect(renderButton().textContent).toBe('Sync to Monarch');
  });
});
