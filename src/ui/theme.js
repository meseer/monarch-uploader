/**
 * Theme Management Module
 * Detects host site dark/light mode and injects CSS custom properties
 * for consistent theming across all Monarch Uploader UI components.
 *
 * Detection methods:
 * - Wealthsimple: <html data-appearance="dark">
 * - Questrade: <body class="dark-theme">
 * - Rogers Bank / Canada Life: always light (no dark mode support)
 *
 * Uses a MutationObserver to watch for theme changes on the host site
 * and applies a data-mu-theme="dark"|"light" attribute on <html>.
 */

import { debugLog } from '../core/utils';

/** CSS custom properties for light and dark themes */
const THEME_VARIABLES = {
  light: {
    '--mu-bg-primary': '#ffffff',
    '--mu-bg-secondary': '#f8f9fa',
    '--mu-bg-tertiary': '#f5f5f5',
    '--mu-text-primary': '#333333',
    '--mu-text-secondary': '#666666',
    '--mu-text-muted': '#888888',
    '--mu-border': '#e5e5e5',
    '--mu-border-light': '#eeeeee',
    '--mu-hover-bg': '#f0f0f0',
    '--mu-input-bg': '#ffffff',
    '--mu-input-border': '#cccccc',
    '--mu-input-text': '#333333',
    '--mu-close-btn-bg': '#6c757d',
    '--mu-overlay-bg': 'rgba(0, 0, 0, 0.7)',

    // Status backgrounds
    '--mu-status-processing-bg': '#e3f2fd',
    '--mu-status-processing-text': '#1565c0',
    '--mu-status-success-bg': '#e8f5e9',
    '--mu-status-success-text': '#2e7d32',
    '--mu-status-success-border': '#c3e6cb',
    '--mu-status-error-bg': '#ffebee',
    '--mu-status-error-text': '#c62828',
    '--mu-status-error-border': '#f5c6cb',
    '--mu-status-skipped-bg': '#f5f5f5',

    // Warning banner (upload button auth message)
    '--mu-warning-bg': '#fff3cd',
    '--mu-warning-text': '#856404',
    '--mu-warning-border': '#ffeaa7',

    // Balance change colors
    '--mu-balance-neutral-bg': '#f5f5f5',
    '--mu-balance-neutral-text': '#666666',
    '--mu-balance-info-bg': '#e3f2fd',
    '--mu-balance-info-text': '#1565c0',

    // Scrollbar
    '--mu-scrollbar-thumb': '#cccccc',
    '--mu-scrollbar-track': '#f5f5f5',

    // Cancel button
    '--mu-cancel-btn-bg': '#f5f5f5',
    '--mu-cancel-btn-text': '#333333',

    // Border variant (mid-tone for hover states)
    '--mu-border-color': '#dddddd',

    // Recommended item highlight
    '--mu-item-recommended-bg': '#f5f8ff',
    '--mu-item-recommended-border': '#d0d9e6',
    '--mu-item-recommended-hover-bg': '#eef2fd',

    // Cancel/danger button
    '--mu-danger-bg': '#dc3545',
    '--mu-danger-text': '#ffffff',

    // Settings modal specific
    '--mu-tab-active-bg': '#ffffff',
    '--mu-tab-active-border': '#007bff',
    '--mu-tab-hover-bg': '#e9ecef',
    '--mu-section-header-bg': '#f0f4f8',
    '--mu-toggle-bg': '#cccccc',
    '--mu-toggle-active-bg': '#007bff',
    '--mu-badge-bg': '#e9ecef',
    '--mu-badge-text': '#495057',
    '--mu-link-color': '#007bff',

    // Closed badge
    '--mu-closed-badge-bg': '#9e9e9e',

    // Error container
    '--mu-error-border': '#f44336',
    '--mu-error-text': '#f44336',
  },
  dark: {
    '--mu-bg-primary': '#1e1e1e',
    '--mu-bg-secondary': '#2d2d2d',
    '--mu-bg-tertiary': '#383838',
    '--mu-text-primary': '#e0e0e0',
    '--mu-text-secondary': '#aaaaaa',
    '--mu-text-muted': '#888888',
    '--mu-border': '#444444',
    '--mu-border-light': '#555555',
    '--mu-hover-bg': '#3a3a3a',
    '--mu-input-bg': '#2d2d2d',
    '--mu-input-border': '#555555',
    '--mu-input-text': '#e0e0e0',
    '--mu-close-btn-bg': '#555555',
    '--mu-overlay-bg': 'rgba(0, 0, 0, 0.85)',

    // Status backgrounds
    '--mu-status-processing-bg': '#1a3a5c',
    '--mu-status-processing-text': '#64b5f6',
    '--mu-status-success-bg': '#1a3c1e',
    '--mu-status-success-text': '#81c784',
    '--mu-status-success-border': '#2e5c32',
    '--mu-status-error-bg': '#4a1a1a',
    '--mu-status-error-text': '#ef9a9a',
    '--mu-status-error-border': '#6b2a2a',
    '--mu-status-skipped-bg': '#383838',

    // Warning banner
    '--mu-warning-bg': '#3d3520',
    '--mu-warning-text': '#ffd54f',
    '--mu-warning-border': '#5c4a1e',

    // Balance change colors
    '--mu-balance-neutral-bg': '#383838',
    '--mu-balance-neutral-text': '#aaaaaa',
    '--mu-balance-info-bg': '#1a3a5c',
    '--mu-balance-info-text': '#64b5f6',

    // Scrollbar
    '--mu-scrollbar-thumb': '#555555',
    '--mu-scrollbar-track': '#2d2d2d',

    // Cancel button
    '--mu-cancel-btn-bg': '#383838',
    '--mu-cancel-btn-text': '#e0e0e0',

    // Border variant (mid-tone for hover states)
    '--mu-border-color': '#555555',

    // Recommended item highlight
    '--mu-item-recommended-bg': '#1a2a3c',
    '--mu-item-recommended-border': '#2a3f5c',
    '--mu-item-recommended-hover-bg': '#1e3350',

    // Cancel/danger button
    '--mu-danger-bg': '#c62828',
    '--mu-danger-text': '#ffffff',

    // Settings modal specific
    '--mu-tab-active-bg': '#1e1e1e',
    '--mu-tab-active-border': '#64b5f6',
    '--mu-tab-hover-bg': '#3a3a3a',
    '--mu-section-header-bg': '#2a2f35',
    '--mu-toggle-bg': '#555555',
    '--mu-toggle-active-bg': '#64b5f6',
    '--mu-badge-bg': '#3a3a3a',
    '--mu-badge-text': '#cccccc',
    '--mu-link-color': '#64b5f6',

    // Closed badge
    '--mu-closed-badge-bg': '#616161',

    // Error container
    '--mu-error-border': '#ef5350',
    '--mu-error-text': '#ef9a9a',
  },
};

let currentTheme = 'light';
let themeStyleElement = null;
let themeObserver = null;

/**
 * Detect the current theme of the host website
 * @returns {'light'|'dark'} Detected theme
 */
function detectHostTheme() {
  // Wealthsimple: <html data-appearance="dark">
  const htmlAppearance = document.documentElement.getAttribute('data-appearance');
  if (htmlAppearance === 'dark') {
    return 'dark';
  }

  // Questrade: <body class="dark-theme">
  if (document.body && document.body.classList.contains('dark-theme')) {
    return 'dark';
  }

  // Rogers Bank / Canada Life: no dark mode
  return 'light';
}

/**
 * Build the CSS text for a given theme
 * @param {'light'|'dark'} theme - Theme name
 * @returns {string} CSS text with custom property declarations
 */
function buildThemeCSS(theme) {
  const vars = THEME_VARIABLES[theme] || THEME_VARIABLES.light;
  const declarations = Object.entries(vars)
    .map(([prop, value]) => `  ${prop}: ${value};`)
    .join('\n');

  return `:root {\n${declarations}\n}`;
}

/**
 * Inject or update the theme <style> element
 * @param {'light'|'dark'} theme - Theme to apply
 */
function applyTheme(theme) {
  if (theme === currentTheme && themeStyleElement) {
    return; // No change needed
  }

  currentTheme = theme;
  document.documentElement.setAttribute('data-mu-theme', theme);

  const cssText = buildThemeCSS(theme);

  if (!themeStyleElement) {
    themeStyleElement = document.createElement('style');
    themeStyleElement.id = 'monarch-uploader-theme';
    document.head.appendChild(themeStyleElement);
  }

  themeStyleElement.textContent = cssText;
  debugLog(`Theme applied: ${theme}`);
}

/**
 * Start watching for host theme changes via MutationObserver
 */
function startThemeObserver() {
  if (themeObserver) {
    themeObserver.disconnect();
  }

  themeObserver = new MutationObserver(() => {
    const detected = detectHostTheme();
    if (detected !== currentTheme) {
      debugLog(`Host theme changed: ${currentTheme} → ${detected}`);
      applyTheme(detected);
    }
  });

  // Watch <html> attributes (Wealthsimple: data-appearance)
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-appearance', 'class'],
  });

  // Watch <body> class changes (Questrade: dark-theme class)
  if (document.body) {
    themeObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  debugLog('Theme observer started');
}

/**
 * Initialize the theme system.
 * Detects the current host theme, injects CSS variables, and starts monitoring.
 * Should be called once during app initialization (from index.js).
 */
export function initTheme() {
  const detected = detectHostTheme();
  applyTheme(detected);
  startThemeObserver();
  debugLog(`Theme system initialized (detected: ${detected})`);
}

/**
 * Get the current theme
 * @returns {'light'|'dark'} Current theme
 */
export function getCurrentTheme() {
  return currentTheme;
}

export default {
  initTheme,
  getCurrentTheme,
};