/**
 * Navigation Handler
 * Handles URL changes and account context switching in SPA environment
 */

import { debugLog, isQuestradeAllAccountsPage } from './utils';
import stateManager from './state';
import accountService from '../services/account';
import uiManager from '../ui/uiManager';

/**
 * Navigation manager class to handle URL changes
 */
class NavigationManager {
  constructor() {
    this.currentUrl = window.location.href;
    this.currentAccountId = null;
    this.currentPageType = null; // Track page type (all-accounts, account, other)
    this.isInitialized = false;
    this.urlCheckInterval = null;

    debugLog('NavigationManager initialized');
  }

  /**
   * Start monitoring URL changes
   */
  startMonitoring() {
    if (this.isInitialized) return;

    // Set initial state from current URL
    this.currentAccountId = this.extractAccountIdFromUrl();
    this.currentPageType = this.getCurrentPageType();
    debugLog(`Initial state - Account ID: ${this.currentAccountId}, Page Type: ${this.currentPageType}`);

    // Listen for popstate events (back/forward navigation)
    window.addEventListener('popstate', () => {
      this.handleUrlChange();
    });

    // Poll for URL changes (for programmatic navigation)
    this.urlCheckInterval = setInterval(() => {
      this.checkUrlChange();
    }, 500); // Check every 500ms

    this.isInitialized = true;
    debugLog('Navigation monitoring started');
  }

  /**
   * Stop monitoring URL changes
   */
  stopMonitoring() {
    if (this.urlCheckInterval) {
      clearInterval(this.urlCheckInterval);
      this.urlCheckInterval = null;
    }
    this.isInitialized = false;
    debugLog('Navigation monitoring stopped');
  }

  /**
   * Check if URL has changed and handle it
   */
  checkUrlChange() {
    const newUrl = window.location.href;
    if (newUrl !== this.currentUrl) {
      this.currentUrl = newUrl;
      this.handleUrlChange();
    }
  }

  /**
   * Handle URL change event
   */
  async handleUrlChange() {
    try {
      debugLog('URL changed to:', window.location.href);

      const newAccountId = this.extractAccountIdFromUrl();
      const newPageType = this.getCurrentPageType();

      // Check if page type or account ID changed
      const pageTypeChanged = newPageType !== this.currentPageType;
      const accountIdChanged = newAccountId !== this.currentAccountId;

      if (pageTypeChanged || accountIdChanged) {
        debugLog(`Navigation detected - Page Type: ${this.currentPageType} → ${newPageType}, Account ID: ${this.currentAccountId} → ${newAccountId}`);

        // Update stored state
        this.currentAccountId = newAccountId;
        this.currentPageType = newPageType;

        // Handle the navigation based on new page type
        await this.handlePageTransition(newPageType, newAccountId);
      }
    } catch (error) {
      debugLog('Error handling URL change:', error);
    }
  }

  /**
   * Extract account ID from current URL
   * @returns {string|null} Account ID or null if not on account page
   */
  extractAccountIdFromUrl() {
    const matches = window.location.pathname.match(/\/accounts\/([^/]+)/);
    return matches?.[1] || null;
  }

  /**
   * Get the current page type
   * @returns {string} Page type: 'all-accounts', 'account', or 'other'
   */
  getCurrentPageType() {
    if (isQuestradeAllAccountsPage()) {
      return 'all-accounts';
    } if (this.extractAccountIdFromUrl()) {
      return 'account';
    }
    return 'other';
  }

  /**
   * Handle page transitions based on page type
   * @param {string} pageType - New page type ('all-accounts', 'account', 'other')
   * @param {string} accountId - New account ID (if on account page)
   */
  async handlePageTransition(pageType, accountId) {
    try {
      // Update state based on page type
      if (pageType === 'account' && accountId) {
        // Load account info and set state
        await accountService.loadCurrentAccountInfo();
        debugLog(`Loaded account info for: ${accountId}`);
      } else {
        // Clear account context for non-account pages
        stateManager.setAccount(null, 'unknown');
        debugLog('Cleared account context');
      }

      // Reinitialize UI for the new page type (UIManager handles smooth updates)
      await this.reinitializeUI();

      debugLog(`Successfully handled page transition to: ${pageType}`);
    } catch (error) {
      debugLog('Error handling page transition:', error);
    }
  }

  /**
   * Reinitialize UI components for the current page
   */
  async reinitializeUI() {
    try {
      // Call the general UI initialization which detects page type
      await uiManager.initUI();
      debugLog('UI reinitialized for current page');
    } catch (error) {
      debugLog('Error reinitializing UI:', error);
    }
  }

  /**
   * Get current account ID
   * @returns {string|null} Current account ID
   */
  getCurrentAccountId() {
    return this.currentAccountId;
  }

  /**
   * Force refresh of current account context
   */
  async forceRefresh() {
    const accountId = this.extractAccountIdFromUrl();
    const pageType = this.getCurrentPageType();

    // Update stored state
    this.currentAccountId = accountId;
    this.currentPageType = pageType;

    // Handle page transition to refresh UI
    await this.handlePageTransition(pageType, accountId);

    debugLog('Force refresh completed');
  }
}

// Create singleton instance
const navigationManager = new NavigationManager();

export default navigationManager;
export { NavigationManager };
