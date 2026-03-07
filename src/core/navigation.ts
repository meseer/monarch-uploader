/**
 * Navigation Handler
 * Handles URL changes and account context switching in SPA environment
 */

import { debugLog, isQuestradeAllAccountsPage } from './utils';
import stateManager from './state';
import accountService from '../services/questrade/account';
import uiManager from '../ui/questrade/uiManager';

/**
 * Navigation manager class to handle URL changes
 */
class NavigationManager {
  private currentUrl: string;
  private currentAccountId: string | null;
  private currentPageType: string | null;
  private isInitialized: boolean;
  private urlCheckInterval: ReturnType<typeof setInterval> | null;

  constructor() {
    this.currentUrl = window.location.href;
    this.currentAccountId = null;
    this.currentPageType = null;
    this.isInitialized = false;
    this.urlCheckInterval = null;

    debugLog('NavigationManager initialized');
  }

  /**
   * Start monitoring URL changes
   */
  startMonitoring(): void {
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
  stopMonitoring(): void {
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
  checkUrlChange(): void {
    const newUrl = window.location.href;
    if (newUrl !== this.currentUrl) {
      this.currentUrl = newUrl;
      this.handleUrlChange();
    }
  }

  /**
   * Handle URL change event
   */
  async handleUrlChange(): Promise<void> {
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
   */
  extractAccountIdFromUrl(): string | null {
    const matches = window.location.pathname.match(/\/accounts\/([^/]+)/);
    return matches?.[1] || null;
  }

  /**
   * Get the current page type
   */
  getCurrentPageType(): string {
    if (isQuestradeAllAccountsPage()) {
      return 'all-accounts';
    } if (this.extractAccountIdFromUrl()) {
      return 'account';
    }
    return 'other';
  }

  /**
   * Handle page transitions based on page type
   */
  async handlePageTransition(pageType: string, accountId: string | null): Promise<void> {
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
  async reinitializeUI(): Promise<void> {
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
   */
  getCurrentAccountId(): string | null {
    return this.currentAccountId;
  }

  /**
   * Force refresh of current account context
   */
  async forceRefresh(): Promise<void> {
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