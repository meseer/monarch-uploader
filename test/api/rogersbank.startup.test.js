/**
 * @vitest-environment-options {"url": "https://selfserve.rogersbank.com/home"}
 */

/**
 * Startup on the Rogers Bank landing page (/home).
 *
 * The userscript runs at `@run-at document-start`. On Rogers Bank pages it
 * installs only the network hooks that early, so the requests the bank page
 * makes while it boots (they carry the credentials) are captured. The rest of
 * startup, including `initApp`, still runs 1 s after DOMContentLoaded, as it
 * did under `@run-at document-idle`.
 *
 * The real `src/index.ts` and every module it imports are loaded; only the
 * bank page (its XHR requests and its DOM) is simulated.
 */

import { createRequire } from 'node:module';
import {
  ACCOUNT_DETAIL_URL,
  CAPTURED,
  installFakeXhr,
  sendPageXhr,
  useInMemoryGmStorage,
  expectNoCredentialsInStorage,
  expectNoCredentialsInCalls,
  simulateDocumentStart,
} from '../helpers/rogersBankPage';

const require = createRequire(import.meta.url);

const LANDING_PAGE_HTML = '<section aria-labelledby="master-card-section"></section>';

/** Evaluate the userscript bundle entry point, as the userscript manager does */
async function injectUserscript() {
  await import('../../src/index');
}

const uploadButton = () => document.getElementById('rogersbank-upload-button');
const uploaderContainer = () => document.getElementById('rogersbank-balance-uploader-container');
const themeApplied = () => document.getElementById('monarch-uploader-theme') !== null;

describe('Rogers Bank startup at document-start', () => {
  let page;
  let gmStore;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    gmStore = useInMemoryGmStorage();
    installFakeXhr();
    globalThis.fetch = jest.fn();
    page = simulateDocumentStart();
  });

  afterEach(() => {
    // Restore while fake timers are on, so the startup it may trigger is cleared
    page.restore();
    jest.clearAllTimers();
    jest.useRealTimers();
    document.getElementById('monarch-uploader-theme')?.remove();
    document.documentElement.removeAttribute('data-mu-theme');
  });

  test('the userscript header runs the script at document-start', () => {
    const generateMetadata = require('../../src/userscript-metadata.cjs');

    expect(generateMetadata()).toMatch(/^\/\/ @run-at\s+document-start$/m);
  });

  test('installs only the network hooks before the page has loaded', async () => {
    const pageSend = XMLHttpRequest.prototype.send;

    await injectUserscript();

    expect(XMLHttpRequest.prototype.send).not.toBe(pageSend);
    expect(GM_registerMenuCommand).not.toHaveBeenCalled();
    expect(GM_setValue).not.toHaveBeenCalled();
    expect(themeApplied()).toBe(false);
  });

  test('captures the landing page boot requests and shows the upload button when the UI starts', async () => {
    await injectUserscript();

    // The bank page boots and loads the account shown on /home, long before
    // document-idle + 1 s, which is when the hooks used to be installed
    sendPageXhr(ACCOUNT_DETAIL_URL);
    page.finishParsing(LANDING_PAGE_HTML);
    jest.advanceTimersByTime(999);
    expect(uploaderContainer()).toBeNull();

    jest.advanceTimersByTime(1);

    expect(uploadButton()).not.toBeNull();
    expect(document.querySelector('.rogersbank-status').textContent).toBe('Rogers Bank: Connected');
    expect((await import('../../src/api/rogersbank')).getRogersBankCredentials()).toEqual(expect.objectContaining(CAPTURED));
  });

  test('does not wrap XMLHttpRequest a second time when the Rogers Bank app starts', async () => {
    await injectUserscript();
    const hookedSend = XMLHttpRequest.prototype.send;

    page.finishParsing(LANDING_PAGE_HTML);
    jest.advanceTimersByTime(1000);

    expect(uploaderContainer()).not.toBeNull();
    expect(XMLHttpRequest.prototype.send).toBe(hookedSend);
  });

  test('stores no credential captured during boot', async () => {
    await injectUserscript();
    sendPageXhr(ACCOUNT_DETAIL_URL);
    page.finishParsing(LANDING_PAGE_HTML);
    jest.advanceTimersByTime(1000);

    expect(uploadButton()).not.toBeNull();
    expectNoCredentialsInStorage(gmStore);
    // Startup purges stored credentials, so also check nothing was ever written
    expectNoCredentialsInCalls(GM_setValue);
  });

  test('a boot request captured before the page has a body does not break it, even with debug toasts on', async () => {
    gmStore = useInMemoryGmStorage({ debug_log_level: 'debug' });
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    const sendSpy = jest.spyOn(XMLHttpRequest.prototype, 'send');
    await injectUserscript();

    expect(() => sendPageXhr(ACCOUNT_DETAIL_URL)).not.toThrow();

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(document.body).toBeNull();
    consoleLog.mockRestore();
  });

  test('starts the Rogers Bank UI at the same time as before: 1 s after DOMContentLoaded', async () => {
    await injectUserscript();
    page.finishParsing(LANDING_PAGE_HTML);

    jest.advanceTimersByTime(0);
    expect(GM_registerMenuCommand).toHaveBeenCalled();
    expect(themeApplied()).toBe(false);

    jest.advanceTimersByTime(999);
    expect(themeApplied()).toBe(false);

    jest.advanceTimersByTime(1);
    expect(themeApplied()).toBe(true);
    expect(uploaderContainer()).not.toBeNull();
  });
});
