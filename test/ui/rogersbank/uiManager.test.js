/**
 * Tests for the Rogers Bank UI's credential states.
 *
 * Rogers Bank credentials are held in memory only, so after every page load
 * the UI starts in the "waiting for credentials" state. It must switch to the
 * upload button as soon as the bank page's own API request is captured, with
 * no reload. The real API client, state manager and UI components are used;
 * only the bank page's requests are simulated.
 */

const {
  TRANSACTIONS_URL,
  installFakeXhr,
  sendPageXhr,
  useInMemoryGmStorage,
  expectNoCredentialsInStorage,
} = require('../../helpers/rogersBankPage');

/** Element factory for the mocks below (jest.mock factories may only reference `mock*` names) */
function mockElement(tag) {
  return document.createElement(tag);
}

jest.mock('../../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

jest.mock('../../../src/services/auth', () => ({
  __esModule: true,
  default: { getMonarchCredentials: jest.fn(() => ({ csrfToken: 'monarch-session' })) },
}));

jest.mock('../../../src/ui/toast', () => ({
  __esModule: true,
  default: { show: jest.fn() },
}));

jest.mock('../../../src/ui/components/settingsModal', () => ({
  showSettingsModal: jest.fn(),
}));

jest.mock('../../../src/ui/components/monarchLoginLink', () => ({
  createMonarchLoginLink: jest.fn(() => mockElement('a')),
  ensureMonarchAuthentication: jest.fn(),
}));

jest.mock('../../../src/ui/components/versionBadge', () => ({
  createVersionBadge: jest.fn(() => mockElement('span')),
}));

jest.mock('../../../src/services/rogersbank-upload', () => ({
  uploadRogersBankToMonarch: jest.fn(),
}));

/** Load fresh module instances, as a new page load would */
function loadPage() {
  let modules;
  jest.isolateModules(() => {
    modules = {
      api: require('../../../src/api/rogersbank'),
      ui: require('../../../src/ui/rogersbank/uiManager'),
    };
  });
  return modules;
}

const uploadButton = () => document.getElementById('rogersbank-upload-button');
const waitingMessage = () => document.getElementById('rogersbank-credentials-waiting-message');
const rogersStatus = () => document.querySelector('.rogersbank-status').textContent;

describe('Rogers Bank UI credential states', () => {
  let gmStore;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    gmStore = useInMemoryGmStorage();
    installFakeXhr();
    globalThis.fetch = jest.fn();
    document.body.innerHTML = '<section aria-labelledby="master-card-section"></section>';
  });

  afterEach(() => {
    jest.useRealTimers();
    document.body.innerHTML = '';
  });

  test('switches from waiting to the upload button when the page request is captured', async () => {
    const { api, ui } = loadPage();
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
    const { api, ui } = loadPage();
    api.setupCredentialInterception();
    await ui.initRogersBankUI();

    sendPageXhr(TRANSACTIONS_URL);

    expect(uploadButton()).not.toBeNull();
    expect(GM_setValue).not.toHaveBeenCalled();
    expectNoCredentialsInStorage(gmStore);
  });

  test('shows the upload button straight away when capture happened before the UI was built', async () => {
    const { api, ui } = loadPage();
    api.setupCredentialInterception();
    sendPageXhr(TRANSACTIONS_URL);

    await ui.initRogersBankUI();

    expect(uploadButton()).not.toBeNull();
    expect(waitingMessage()).toBeNull();
  });

  test('starts in the waiting state again after a reload', async () => {
    const firstPage = loadPage();
    firstPage.api.setupCredentialInterception();
    await firstPage.ui.initRogersBankUI();
    sendPageXhr(TRANSACTIONS_URL);
    expect(uploadButton()).not.toBeNull();

    // Reload: same GM storage, fresh page and fresh modules
    document.body.innerHTML = '<section aria-labelledby="master-card-section"></section>';
    installFakeXhr();
    const reloaded = loadPage();
    reloaded.api.setupCredentialInterception();
    await reloaded.ui.initRogersBankUI();

    expect(waitingMessage()).not.toBeNull();
    expect(uploadButton()).toBeNull();
  });
});
