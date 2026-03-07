/**
 * MBNA UI Injection Point Configuration
 *
 * Defines where and how to inject the uploader UI on the MBNA website.
 * The MBNA site is an Angular SPA at service.mbna.ca with hash-based routing.
 *
 * Each page mode has its own selectors array, allowing different injection
 * targets per page. The dashboard page uses `app-quick-links:not([hidden])`
 * to skip hidden instances, while the snapshot page uses
 * `div.snapshot-quick-link-wrapper`.
 *
 * @module integrations/mbna/source/injectionPoint
 */

import type { IntegrationInjectionPoint } from '../../types';

const injectionPoint: IntegrationInjectionPoint = {
  // Global selectors fallback (empty  prefer per-page-mode selectors)
  selectors: [],

  // MBNA uses Angular SPA with hash-based routing
  isSPA: true,

  // Page modes: what UI to show based on URL, each with its own selectors
  pageModes: [
    {
      id: 'dashboard',
      urlPattern: /accountsoverview/,
      uiType: 'all-accounts',
      selectors: [
        { selector: 'app-quick-links:not([hidden])', insertMethod: 'insertAfter' },
      ],
    },
    {
      id: 'snapshot',
      urlPattern: /account\/snapshot/,
      uiType: 'single-account',
      selectors: [
        { selector: 'div.snapshot-quick-link-wrapper', insertMethod: 'insertAfter' },
      ],
    },
  ],

  // URL patterns indicating valid app pages (after login)
  appPagePatterns: [/accountsoverview/, /account\/snapshot/],

  // URL patterns to skip (login, loading screens)
  skipPatterns: [/sign-in/, /login/, /sso/],

  // DOM ID for the injected UI container
  containerId: 'monarch-uploader-mbna',
};

export default injectionPoint;