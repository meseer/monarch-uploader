/**
 * Tests for the Rogers Bank UI's credential states.
 *
 * Rogers Bank credentials are held in memory only, so after every page load
 * the UI starts in the "waiting for credentials" state. It must switch to the
 * upload button as soon as the bank page's own API request is captured, with
 * no reload. The real API client, state manager and UI components are used;
 * only the bank page's requests are simulated.
 */

import {
  TRANSACTIONS_URL,
  installFakeXhr,
  sendPageXhr,
  useInMemoryGmStorage,
  expectNoCredentialsInStorage,
} from '../../helpers/rogersBankPage';
import * as utilsModule from '../../../src/core/utils';

/** Element factory for the mocks below (jest.mock factories may only reference `mock*` names) */
function mockElement(tag) {
  return document.createElement(tag);
}

vi.mock('../../../src/core/utils', () => ({
  debugLog: vi.fn(),
}));

vi.mock('../../../src/services/auth', () => ({
  __esModule: true,
  default: { getMonarchCredentials: vi.fn(() => ({ csrfToken: 'monarch-session' })) },
}));

vi.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: vi.fn() },
}));

vi.mock('../../../src/ui/components/settingsModal', () => ({
  showSettingsModal: vi.fn(),
}));

vi.mock('../../../src/ui/components/monarchLoginLink', () => ({
  createMonarchLoginLink: vi.fn(() => mockElement('a')),
  ensureMonarchAuthentication: vi.fn(),
}));

vi.mock('../../../src/ui/components/versionBadge', () => ({
  createVersionBadge: vi.fn(() => mockElement('span')),
}));

vi.mock('../../../src/services/rogersbank-upload', () => ({
  uploadRogersBankToMonarch: vi.fn(),
}));

/** Load fresh module instances, as a new page load would */
async function loadPage() {
  vi.resetModules();
  return {
    api: await import('../../../src/api/rogersbank'),
    ui: await import('../../../src/ui/rogersbank/uiManager'),
  };
}

const uploadButton = () => document.getElementById('rogersbank-upload-button');
const waitingMessage = () => document.getElementById('rogersbank-credentials-waiting-message');
const rogersStatus = () => document.querySelector('.rogersbank-status').textContent;

describe('Rogers Bank UI credential states', () => {
  let gmStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    gmStore = useInMemoryGmStorage();
    installFakeXhr();
    globalThis.fetch = vi.fn();
    document.body.innerHTML = '<section aria-labelledby="master-card-section"></section>';
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  test('switches from waiting to the upload button when the page request is captured', async () => {
    const { api, ui } = await loadPage();
    api.setupCredentialInterception();
    await ui.initRogersBankUI();

    expect(waitingMessage()).not.toBeNull();
    expect(uploadButton()).toBeNull();
    expect(rogersStatus()).toBe('Rogers Bank: Missing (token, account, customer, device)');

    // Rogers Bank's own page loads its transactions
    sendPageXhr(TRANSACTIONS_URL);

    expect(uploadButton()).not.toBeNull();
    expect(waitingMessage()).toBeNull();
    expect(rogersStatus()).toBe('Rogers Bank: Connected');
  });

  test('stores nothing while capturing credentials and updating the UI', async () => {
    const { api, ui } = await loadPage();
    api.setupCredentialInterception();
    await ui.initRogersBankUI();

    sendPageXhr(TRANSACTIONS_URL);

    expect(uploadButton()).not.toBeNull();
    expect(GM_setValue).not.toHaveBeenCalled();
    expectNoCredentialsInStorage(gmStore);
  });

  test('shows the upload button straight away when capture happened before the UI was built', async () => {
    const { api, ui } = await loadPage();
    api.setupCredentialInterception();
    sendPageXhr(TRANSACTIONS_URL);

    await ui.initRogersBankUI();

    expect(uploadButton()).not.toBeNull();
    expect(waitingMessage()).toBeNull();
  });

  test('starts in the waiting state again after a reload', async () => {
    const firstPage = await loadPage();
    firstPage.api.setupCredentialInterception();
    await firstPage.ui.initRogersBankUI();
    sendPageXhr(TRANSACTIONS_URL);
    expect(uploadButton()).not.toBeNull();

    // Reload: same GM storage, fresh page and fresh modules
    document.body.innerHTML = '<section aria-labelledby="master-card-section"></section>';
    installFakeXhr();
    const reloaded = await loadPage();
    reloaded.api.setupCredentialInterception();
    await reloaded.ui.initRogersBankUI();

    expect(waitingMessage()).not.toBeNull();
    expect(uploadButton()).toBeNull();
  });

  test('does not treat a URL change from before monitoring started as a navigation', async () => {
    const { debugLog } = utilsModule;
    window.history.replaceState({}, '', '/');
    try {
      // The module loads at document-start; the bank page then redirects while booting
      const { api, ui } = await loadPage();
      window.history.replaceState({}, '', '/home');
      api.setupCredentialInterception();
      await ui.initRogersBankUI();
      debugLog.mockClear();

      vi.advanceTimersByTime(500);

      expect(debugLog).not.toHaveBeenCalledWith('Rogers Bank URL changed to:', expect.anything());
    } finally {
      window.history.replaceState({}, '', '/');
    }
  });
});
