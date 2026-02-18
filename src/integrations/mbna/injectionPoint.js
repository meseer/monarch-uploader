/**
 * MBNA UI Injection Point Configuration
 *
 * Defines where and how to inject the uploader UI on the MBNA website.
 * The MBNA site is an Angular SPA at service.mbna.ca with hash-based routing.
 *
 * @type {import('../types').IntegrationInjectionPoint}
 * @module integrations/mbna/injectionPoint
 */

/** @type {import('../types').IntegrationInjectionPoint} */
const injectionPoint = {
  // CSS selectors tried in order to find injection target
  selectors: [
    { selector: 'app-quick-links', insertMethod: 'insertAfter' },
  ],

  // MBNA uses Angular SPA with hash-based routing
  isSPA: true,

  // Page modes: what UI to show based on URL
  pageModes: [
    {
      id: 'dashboard',
      urlPattern: /accountsoverview/,
      uiType: 'all-accounts',
    },
  ],

  // URL patterns indicating valid app pages (after login)
  appPagePatterns: [/accountsoverview/, /account/],

  // URL patterns to skip (login, loading screens)
  skipPatterns: [/sign-in/, /login/, /sso/],

  // DOM ID for the injected UI container
  containerId: 'monarch-uploader-mbna',
};

export default injectionPoint;