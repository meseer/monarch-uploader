/**
 * Tests for Theme Management Module
 */

// Mock debugLog
jest.mock('../../src/core/utils', () => ({
  debugLog: jest.fn(),
}));

// We need to test the module in isolation, so we'll import after setting up DOM
let initTheme;
let getCurrentTheme;

describe('Theme Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.documentElement.removeAttribute('data-appearance');
    document.documentElement.removeAttribute('data-mu-theme');
    document.body.className = '';

    // Remove any existing theme style elements
    const existing = document.getElementById('monarch-uploader-theme');
    if (existing) existing.remove();

    // Reset module state by re-requiring
    jest.resetModules();
    const theme = require('../../src/ui/theme');
    initTheme = theme.initTheme;
    getCurrentTheme = theme.getCurrentTheme;
  });

  afterEach(() => {
    // Clean up
    const existing = document.getElementById('monarch-uploader-theme');
    if (existing) existing.remove();
    document.documentElement.removeAttribute('data-appearance');
    document.documentElement.removeAttribute('data-mu-theme');
    document.body.className = '';
  });

  describe('initTheme', () => {
    test('injects theme style element into document head', () => {
      initTheme();

      const styleEl = document.getElementById('monarch-uploader-theme');
      expect(styleEl).not.toBeNull();
      expect(styleEl.tagName).toBe('STYLE');
    });

    test('sets data-mu-theme attribute on html element', () => {
      initTheme();

      const attr = document.documentElement.getAttribute('data-mu-theme');
      expect(attr).toBe('light');
    });

    test('detects light theme by default', () => {
      initTheme();

      expect(getCurrentTheme()).toBe('light');
    });

    test('includes CSS custom properties in style element', () => {
      initTheme();

      const styleEl = document.getElementById('monarch-uploader-theme');
      expect(styleEl.textContent).toContain('--mu-bg-primary');
      expect(styleEl.textContent).toContain('--mu-text-primary');
      expect(styleEl.textContent).toContain('--mu-border');
    });

    test('light theme has white background primary', () => {
      initTheme();

      const styleEl = document.getElementById('monarch-uploader-theme');
      expect(styleEl.textContent).toContain('--mu-bg-primary: #ffffff');
    });
  });

  describe('Wealthsimple dark mode detection', () => {
    test('detects dark theme from data-appearance="dark"', () => {
      document.documentElement.setAttribute('data-appearance', 'dark');

      initTheme();

      expect(getCurrentTheme()).toBe('dark');
      expect(document.documentElement.getAttribute('data-mu-theme')).toBe('dark');
    });

    test('detects light theme from data-appearance="light"', () => {
      document.documentElement.setAttribute('data-appearance', 'light');

      initTheme();

      expect(getCurrentTheme()).toBe('light');
    });

    test('dark theme has dark background primary', () => {
      document.documentElement.setAttribute('data-appearance', 'dark');

      initTheme();

      const styleEl = document.getElementById('monarch-uploader-theme');
      expect(styleEl.textContent).toContain('--mu-bg-primary: #1e1e1e');
    });

    test('dark theme has light text primary', () => {
      document.documentElement.setAttribute('data-appearance', 'dark');

      initTheme();

      const styleEl = document.getElementById('monarch-uploader-theme');
      expect(styleEl.textContent).toContain('--mu-text-primary: #e0e0e0');
    });
  });

  describe('Questrade dark mode detection', () => {
    test('detects dark theme from body class "dark-theme"', () => {
      document.body.classList.add('dark-theme');

      initTheme();

      expect(getCurrentTheme()).toBe('dark');
      expect(document.documentElement.getAttribute('data-mu-theme')).toBe('dark');
    });

    test('detects light theme from body class "light-theme"', () => {
      document.body.classList.add('light-theme');

      initTheme();

      expect(getCurrentTheme()).toBe('light');
    });
  });

  describe('Theme CSS variables', () => {
    test('light theme includes all required variable groups', () => {
      initTheme();

      const styleEl = document.getElementById('monarch-uploader-theme');
      const css = styleEl.textContent;

      // Background variables
      expect(css).toContain('--mu-bg-primary');
      expect(css).toContain('--mu-bg-secondary');
      expect(css).toContain('--mu-bg-tertiary');

      // Text variables
      expect(css).toContain('--mu-text-primary');
      expect(css).toContain('--mu-text-secondary');
      expect(css).toContain('--mu-text-muted');

      // Border variables
      expect(css).toContain('--mu-border');
      expect(css).toContain('--mu-border-light');

      // Input variables
      expect(css).toContain('--mu-input-bg');
      expect(css).toContain('--mu-input-border');
      expect(css).toContain('--mu-input-text');

      // Status variables
      expect(css).toContain('--mu-status-processing-bg');
      expect(css).toContain('--mu-status-success-bg');
      expect(css).toContain('--mu-status-error-bg');

      // Warning variables
      expect(css).toContain('--mu-warning-bg');
      expect(css).toContain('--mu-warning-text');

      // Overlay
      expect(css).toContain('--mu-overlay-bg');
    });

    test('dark theme includes all required variable groups', () => {
      document.documentElement.setAttribute('data-appearance', 'dark');
      initTheme();

      const styleEl = document.getElementById('monarch-uploader-theme');
      const css = styleEl.textContent;

      // Verify dark-specific values
      expect(css).toContain('--mu-bg-primary: #1e1e1e');
      expect(css).toContain('--mu-bg-secondary: #2d2d2d');
      expect(css).toContain('--mu-text-primary: #e0e0e0');
      expect(css).toContain('--mu-border: #444444');
      expect(css).toContain('--mu-input-bg: #2d2d2d');
      expect(css).toContain('--mu-status-processing-bg: #1a3a5c');
      expect(css).toContain('--mu-warning-bg: #3d3520');
    });
  });

  describe('getCurrentTheme', () => {
    test('returns light before initialization', () => {
      // Before init, default is light
      expect(getCurrentTheme()).toBe('light');
    });

    test('returns correct theme after initialization', () => {
      document.documentElement.setAttribute('data-appearance', 'dark');
      initTheme();
      expect(getCurrentTheme()).toBe('dark');
    });
  });

  describe('Theme observer (MutationObserver)', () => {
    test('updates theme when data-appearance changes', async () => {
      initTheme();
      expect(getCurrentTheme()).toBe('light');

      // Simulate Wealthsimple toggling dark mode
      document.documentElement.setAttribute('data-appearance', 'dark');

      // MutationObserver is async, wait for it
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(getCurrentTheme()).toBe('dark');
      expect(document.documentElement.getAttribute('data-mu-theme')).toBe('dark');
    });

    test('updates theme when body class changes to dark-theme', async () => {
      initTheme();
      expect(getCurrentTheme()).toBe('light');

      // Simulate Questrade toggling dark mode
      document.body.classList.add('dark-theme');

      // MutationObserver is async, wait for it
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(getCurrentTheme()).toBe('dark');
    });

    test('switches back to light when dark mode is removed', async () => {
      document.documentElement.setAttribute('data-appearance', 'dark');
      initTheme();
      expect(getCurrentTheme()).toBe('dark');

      // Remove dark mode
      document.documentElement.setAttribute('data-appearance', 'light');

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(getCurrentTheme()).toBe('light');
    });
  });

  describe('Style element reuse', () => {
    test('does not create duplicate style elements on multiple inits', () => {
      initTheme();
      initTheme(); // Second call should reuse

      const styleElements = document.querySelectorAll('#monarch-uploader-theme');
      expect(styleElements.length).toBe(1);
    });
  });
});