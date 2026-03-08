/**
 * Theme management
 * Handles light/dark theme detection and application for host sites
 * (Wealthsimple, Questrade, etc.)
 */

import { debugLog } from '../core/utils';

export type Theme = 'light' | 'dark';

interface ThemeVariables {
  [key: string]: string;
}

interface ThemeConfig {
  light: ThemeVariables;
  dark: ThemeVariables;
}

const THEME_VARIABLES: ThemeConfig = {
  light: {
    '--mu-bg-primary': '#ffffff',
    '--mu-bg-secondary': '#f5f5f5',
    '--mu-bg-tertiary': '#eeeeee',
    '--mu-text-primary': '#212121',
    '--mu-text-secondary': '#757575',
    '--mu-text-muted': '#9e9e9e',
    '--mu-border': '#dddddd',
    '--mu-border-light': '#eeeeee',
    '--mu-input-bg': '#ffffff',
    '--mu-input-border': '#cccccc',
    '--mu-input-text': '#212121',
    '--mu-status-processing-bg': '#e3f2fd',
    '--mu-status-success-bg': '#e8f5e9',
    '--mu-status-error-bg': '#ffebee',
    '--mu-warning-bg': '#fff8e1',
    '--mu-warning-text': '#e65100',
    '--mu-overlay-bg': 'rgba(0, 0, 0, 0.5)',
  },
  dark: {
    '--mu-bg-primary': '#1e1e1e',
    '--mu-bg-secondary': '#2d2d2d',
    '--mu-bg-tertiary': '#3a3a3a',
    '--mu-text-primary': '#e0e0e0',
    '--mu-text-secondary': '#aaaaaa',
    '--mu-text-muted': '#777777',
    '--mu-border': '#444444',
    '--mu-border-light': '#383838',
    '--mu-input-bg': '#2d2d2d',
    '--mu-input-border': '#555555',
    '--mu-input-text': '#e0e0e0',
    '--mu-status-processing-bg': '#1a3a5c',
    '--mu-status-success-bg': '#1b3a1f',
    '--mu-status-error-bg': '#3a1a1a',
    '--mu-warning-bg': '#3d3520',
    '--mu-warning-text': '#ffcc80',
    '--mu-overlay-bg': 'rgba(0, 0, 0, 0.7)',
  },
};

let currentTheme: Theme = 'light';
let themeStyleElement: HTMLStyleElement | null = null;
let themeObserver: MutationObserver | null = null;

/**
 * Detect the current theme of the host page
 */
function detectHostTheme(): Theme {
  try {
    const htmlEl = document.documentElement;
    const bodyEl = document.body;

    // Wealthsimple uses data-appearance attribute
    const dataAppearance = htmlEl.getAttribute('data-appearance');
    if (dataAppearance === 'dark') return 'dark';
    if (dataAppearance === 'light') return 'light';

    // Questrade uses body class
    if (bodyEl.classList.contains('dark-theme')) return 'dark';
    if (bodyEl.classList.contains('light-theme')) return 'light';

    // Generic dark mode detection
    if (
      htmlEl.classList.contains('dark') ||
      htmlEl.getAttribute('data-theme') === 'dark' ||
      bodyEl.classList.contains('dark') ||
      bodyEl.getAttribute('data-theme') === 'dark'
    ) {
      return 'dark';
    }
  } catch (error) {
    debugLog('Error detecting host theme:', error);
  }

  return 'light';
}

/**
 * Build CSS string from theme variables
 */
function buildThemeCSS(theme: Theme): string {
  const variables = THEME_VARIABLES[theme];
  const cssVars = Object.entries(variables)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');

  return `:root {\n${cssVars}\n}`;
}

/**
 * Apply a theme to the page
 */
function applyTheme(theme: Theme): void {
  currentTheme = theme;

  if (!themeStyleElement) {
    themeStyleElement = document.createElement('style');
    themeStyleElement.id = 'monarch-uploader-theme';
    document.head.appendChild(themeStyleElement);
  }

  themeStyleElement.textContent = buildThemeCSS(theme);
  document.documentElement.setAttribute('data-mu-theme', theme);
  debugLog(`Theme applied: ${theme}`);
}

/**
 * Start observing host page for theme changes
 */
function startThemeObserver(): void {
  if (themeObserver) {
    themeObserver.disconnect();
  }

  themeObserver = new MutationObserver(() => {
    const detectedTheme = detectHostTheme();
    if (detectedTheme !== currentTheme) {
      debugLog(`Theme change detected: ${currentTheme} → ${detectedTheme}`);
      applyTheme(detectedTheme);
    }
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'data-theme', 'data-appearance'],
  });

  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-theme'],
  });
}

/**
 * Initialize the theme system
 */
export function initTheme(): void {
  const detectedTheme = detectHostTheme();
  applyTheme(detectedTheme);
  startThemeObserver();
  debugLog(`Theme initialized: ${detectedTheme}`);
}

/**
 * Get the currently active theme
 */
export function getCurrentTheme(): Theme {
  return currentTheme;
}

export default {
  initTheme,
  getCurrentTheme,
};