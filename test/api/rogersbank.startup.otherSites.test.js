/**
 * @vitest-environment-options {"url": "https://myportal.questrade.com/investing/summary"}
 */

/**
 * Startup on a site other than Rogers Bank (Questrade here).
 *
 * The userscript runs at `@run-at document-start` so that Rogers Bank's
 * network hooks can be installed early. On every other site nothing may run
 * that early: startup, and `initApp` 1 s later, must happen exactly when they
 * did under `@run-at document-idle`, i.e. once DOMContentLoaded has fired.
 * The only host check before `initApp` is the Rogers Bank one, so one other
 * host covers them all.
 *
 * The real `src/index.ts` and every module it imports are loaded, so this also
 * checks that evaluating the bundle at document-start touches neither the DOM
 * nor userscript storage, and does not wrap the page's XHR or fetch.
 */

import { simulateDocumentStart } from '../helpers/rogersBankPage';

/** Evaluate the userscript bundle entry point, as the userscript manager does */
async function injectUserscript() {
  await import('../../src/index');
}

/** `initApp` applies the theme first, so its style element marks that initApp ran */
const initAppRan = () => document.getElementById('monarch-uploader-theme') !== null;

describe('startup on other sites', () => {
  let page;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    // Restore while fake timers are on, so the startup it may trigger is cleared
    page?.restore();
    page = null;
    vi.clearAllTimers();
    vi.useRealTimers();
    document.getElementById('monarch-uploader-theme')?.remove();
    document.documentElement.removeAttribute('data-mu-theme');
  });

  describe('when injected at document-start', () => {
    beforeEach(() => {
      page = simulateDocumentStart();
    });

    test('does nothing before DOMContentLoaded', async () => {
      const pageSend = XMLHttpRequest.prototype.send;
      const pageOpen = XMLHttpRequest.prototype.open;
      const pageFetch = vi.fn();
      globalThis.fetch = pageFetch;
      const headBefore = document.head.innerHTML;

      await injectUserscript();
      vi.advanceTimersByTime(60000);

      expect(XMLHttpRequest.prototype.send).toBe(pageSend);
      expect(XMLHttpRequest.prototype.open).toBe(pageOpen);
      expect(globalThis.fetch).toBe(pageFetch);
      expect(GM_registerMenuCommand).not.toHaveBeenCalled();
      expect(GM_setValue).not.toHaveBeenCalled();
      expect(GM_deleteValue).not.toHaveBeenCalled();
      expect(document.head.innerHTML).toBe(headBefore);
      expect(document.body).toBeNull();
      expect(initAppRan()).toBe(false);
    });

    test('starts the script where document-idle did, once DOMContentLoaded has been dispatched', async () => {
      await injectUserscript();
      page.finishParsing('<div id="app"></div>');
      expect(GM_registerMenuCommand).not.toHaveBeenCalled();

      vi.advanceTimersByTime(0);

      expect(GM_registerMenuCommand).toHaveBeenCalledTimes(5);
      expect(initAppRan()).toBe(false);
    });

    test('runs initApp 1 s after DOMContentLoaded, not earlier', async () => {
      await injectUserscript();
      page.finishParsing('<div id="app"></div>');

      vi.advanceTimersByTime(999);
      expect(initAppRan()).toBe(false);

      vi.advanceTimersByTime(1);
      expect(initAppRan()).toBe(true);
    });

    test('lets the page handle DOMContentLoaded before the script starts', async () => {
      const order = [];
      await injectUserscript();
      document.addEventListener('DOMContentLoaded', () => order.push('page listener'));
      GM_registerMenuCommand.mockImplementationOnce(() => order.push('script start'));

      page.finishParsing();
      vi.advanceTimersByTime(0);

      expect(order).toEqual(['page listener', 'script start']);
    });
  });

  describe('when injected after DOMContentLoaded (the old document-idle point)', () => {
    test('starts straight away and runs initApp 1 s later, as before', async () => {
      expect(document.readyState).not.toBe('loading');

      await injectUserscript();
      expect(GM_registerMenuCommand).toHaveBeenCalledTimes(5);

      vi.advanceTimersByTime(999);
      expect(initAppRan()).toBe(false);

      vi.advanceTimersByTime(1);
      expect(initAppRan()).toBe(true);
    });

    test('does not install the Rogers Bank network hooks', async () => {
      const pageSend = XMLHttpRequest.prototype.send;

      await injectUserscript();
      vi.advanceTimersByTime(1000);

      expect(XMLHttpRequest.prototype.send).toBe(pageSend);
    });
  });
});
