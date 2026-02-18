/**
 * Main entry point for the Questrade to Monarch balance uploader userscript
 * This file is the entry point for the webpack build process
 * It imports all modules and initializes the application
 */

// Import core modules
import { STORAGE } from './core/config';
import {
  debugLog,
  clearAllGmStorage,
  clearTransactionUploadHistory,
  clearAccountMapping,
  clearLastUploadedDate,
} from './core/utils';
import { clearSavedCategoryMappings } from './mappers/category';
import { migrateAllLegacyStorage } from './services/common/legacyMigration';
import stateManager from './core/state';
import navigationManager from './core/navigation';
import { registerIntegration } from './core/integrationRegistry';
import { createGMHttpClient } from './core/httpClient';
import { createGMStorageAdapter } from './core/storageAdapter';
import { AVAILABLE_INTEGRATIONS } from './integrations';

// Import API clients
import { checkTokenStatus } from './api/questrade';
import monarchApi from './api/monarch';
import { setupTokenMonitoring, checkTokenStatus as checkCanadaLifeTokenStatus, loadCanadaLifeAccounts } from './api/canadalife';
import { setupCredentialInterception } from './api/rogersbank';
import { setupTokenMonitoring as setupWealthsimpleTokenMonitoring, checkAuth as checkWealthsimpleAuth } from './api/wealthsimple';

// Import UI components
import { initTheme } from './ui/theme';
import toast from './ui/toast';
import { initUI, updateStatusIndicators } from './ui/questrade/uiManager';
import { initCanadaLifeUI } from './ui/canadalife/uiManager';
import { initRogersBankUI } from './ui/rogersbank/uiManager';
import { initWealthsimpleUI } from './ui/wealthsimple/uiManager';
import { initMbnaUI } from './ui/mbna/uiManager';
import { loadCurrentAccountInfo } from './services/questrade/account';

// Main IIFE - application entry point
(function initMonarchUploader() {
  debugLog('Initializing Questrade to Monarch balance uploader...');

  // Register Tampermonkey menu commands
  GM_registerMenuCommand('Clear All Cached Data', clearAllGmStorage);
  GM_registerMenuCommand('Clear Transaction Upload History', clearTransactionUploadHistory);
  GM_registerMenuCommand('Clear Account Mapping', clearAccountMapping);
  GM_registerMenuCommand('Clear Last Uploaded Date', clearLastUploadedDate);
  GM_registerMenuCommand('Clear Category Mappings', clearSavedCategoryMappings);

  // Run eager migration of all legacy storage keys to configStore
  migrateAllLegacyStorage();

  // Register modular integrations in the runtime registry
  // This must happen before any UI renders so settings tabs and
  // connection-status checks can discover registered modules.
  const httpClient = createGMHttpClient();
  const storage = createGMStorageAdapter();
  AVAILABLE_INTEGRATIONS.forEach((integration) => {
    registerIntegration({
      manifest: integration.manifest,
      api: integration.createApi(httpClient, storage),
      auth: integration.createAuth(storage),
      injectionPoint: integration.injectionPoint,
      monarchMapper: integration.monarchMapper || null,
    });
  });

  // Initialize the application once the DOM is ready

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initApp();
    });
  } else {
    // Small delay to ensure Questrade has initialized
    setTimeout(() => {
      initApp();
    }, 1000);
  }

  // document.addEventListener('DOMContentLoaded', () => {
  //     initApp();
  // });

  // Also try to initialize immediately in case DOMContentLoaded already fired
  // if (document.readyState === 'complete' || document.readyState === 'interactive') {
  //     initApp();
  // }

  /**
     * Main application initialization
     */
  function initApp() {
    // Initialize theme system early (before any UI renders)
    // This injects CSS custom properties that all components rely on
    initTheme();

    // Check which site we're on and take appropriate action
    if (window.location.hostname.includes('monarch.com')) {
      debugLog('Running on Monarch site');
      // Set up token capture on Monarch's site
      monarchApi.setupTokenCapture();
      return; // Exit early - nothing else to do on Monarch's site
    }

    // When running on Questrade, initialize the full application
    if (window.location.hostname.includes('questrade.com')) {
      debugLog('Running on Questrade site');

      // Initialize components
      initializeApp();

      // Set up periodic status checks
      setInterval(checkStatus, 10000); // Check every 10 seconds
      return;
    }

    // When running on CanadaLife, initialize CanadaLife application
    if (window.location.hostname.includes('canadalife.com')) {
      debugLog('Running on CanadaLife site');

      // Initialize CanadaLife components
      initializeCanadaLifeApp();

      // Set up periodic status checks
      setInterval(checkCanadaLifeStatus, 10000); // Check every 10 seconds
      return;
    }

    // When running on Rogers Bank, initialize Rogers Bank application
    if (window.location.hostname.includes('rogersbank.com')) {
      debugLog('Running on Rogers Bank site');

      // Initialize Rogers Bank components
      initializeRogersBankApp();

      // Initialize Monarch token monitoring (event-driven, no polling)
      initializeMonarchTokenMonitoring();
      return;
    }

    // When running on MBNA, initialize MBNA application
    if (window.location.hostname.includes('service.mbna.ca')
        || window.location.hostname.includes('mbna.ca')) {
      debugLog('Running on MBNA site');

      // Initialize MBNA components
      initializeMbnaApp();

      // Initialize Monarch token monitoring (event-driven, no polling)
      initializeMonarchTokenMonitoring();
      return;
    }

    // When running on Wealthsimple, initialize Wealthsimple application
    if (window.location.hostname.includes('wealthsimple.com')) {
      debugLog('Running on Wealthsimple site');

      // Initialize Wealthsimple components
      initializeWealthsimpleApp();

      // Set up periodic status checks
      setInterval(checkWealthsimpleStatus, 10000); // Check every 10 seconds
      return;
    }

    debugLog('Running on unsupported site:', window.location.hostname);
  }

  /**
     * Initialize the application components
     */
  function initializeApp() {
    try {
      debugLog('Initializing application components...');

      // Start navigation monitoring for account switching
      navigationManager.startMonitoring();

      // Check auth status immediately
      checkStatus();

      // Initialize UI
      initUI()
        .then(() => debugLog('UI initialized successfully'))
        .catch((err) => debugLog('Error initializing UI:', err));

      // Load current account info if on an account page
      if (window.location.pathname.match(/\/accounts\/([^/]+)/)) {
        loadCurrentAccountInfo()
          .then((account) => {
            if (account) {
              debugLog('Current account loaded:', account.nickname || account.name);
            }
          })
          .catch((err) => debugLog('Error loading account info:', err));
      }

      // Show initialization toast
      toast.show('Balance Uploader initialized', 'debug', 2000);
    } catch (error) {
      debugLog('Error initializing application:', error);
    }
  }

  /**
     * Check if the current Canada Life page is a valid app page (under /s/*)
     * Login and loading pages (e.g., /sign-in, /secur/frontdoor.jsp) should be skipped
     * @returns {boolean} True if on a valid app page
     */
  function isCanadaLifeAppPage() {
    return window.location.pathname.startsWith('/s/');
  }

  /**
     * Initialize CanadaLife application components
     */
  function initializeCanadaLifeApp() {
    try {
      debugLog('Initializing CanadaLife application components...');

      // Set up token monitoring (always runs, even on login pages)
      setupTokenMonitoring();

      // Check auth status immediately (always runs)
      checkCanadaLifeStatus();

      // Only load accounts and initialize UI on valid app pages (under /s/*)
      // Login pages (/sign-in) and loading pages (/secur/frontdoor.jsp) don't have
      // the auth token or navigation elements yet
      if (isCanadaLifeAppPage()) {
        debugLog('On Canada Life app page, initializing fully');
        initializeCanadaLifeAppPage();
      } else {
        debugLog('On Canada Life login/loading page, deferring initialization until navigation to /s/*');
        waitForCanadaLifeAppPage();
      }
    } catch (error) {
      debugLog('Error initializing CanadaLife application:', error);
    }
  }

  /**
     * Initialize Canada Life account loading and UI (only on /s/* pages)
     */
  function initializeCanadaLifeAppPage() {
    // Pre-load accounts from API to refresh cache with full account details
    // This ensures cached accounts have all required fields (EnglishShortName, agreementId, etc.)
    // and triggers migration from old minimal storage to full API data structure
    loadCanadaLifeAccounts(true) // forceRefresh=true
      .then((accounts) => {
        debugLog(`Pre-loaded ${accounts.length} Canada Life accounts with full details`);
      })
      .catch((err) => {
        // Non-fatal - accounts will be loaded when sync is triggered
        debugLog('Error pre-loading Canada Life accounts:', err);
      });

    // Initialize CanadaLife UI
    initCanadaLifeUI()
      .then(() => debugLog('CanadaLife UI initialized successfully'))
      .catch((err) => debugLog('Error initializing CanadaLife UI:', err));
  }

  /**
     * Poll for navigation from login/loading page to a valid /s/* app page.
     * Once detected, runs full initialization and stops polling.
     */
  function waitForCanadaLifeAppPage() {
    let hasInitialized = false;

    const pollInterval = setInterval(() => {
      if (hasInitialized) return;

      if (isCanadaLifeAppPage()) {
        hasInitialized = true;
        clearInterval(pollInterval);
        debugLog('Canada Life navigated to app page, initializing now');
        initializeCanadaLifeAppPage();
      }
    }, 1000); // Check every 1 second

    // Safety timeout: stop polling after 5 minutes
    setTimeout(() => {
      if (!hasInitialized) {
        clearInterval(pollInterval);
        debugLog('Timeout waiting for Canada Life app page navigation (5 min)');
      }
    }, 300000);
  }

  /**
     * Check auth status and update UI (Questrade)
     */
  function checkStatus() {
    try {
      // Check Questrade token status
      checkTokenStatus();

      // Check if we have a Monarch token
      const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);
      stateManager.setMonarchAuth(monarchToken);

      // Update UI with status
      const { indicators } = stateManager.getState().ui;
      updateStatusIndicators(indicators);
    } catch (error) {
      debugLog('Error checking status:', error);
    }
  }

  /**
     * Check auth status for CanadaLife
     */
  function checkCanadaLifeStatus() {
    try {
      // Check CanadaLife token status
      checkCanadaLifeTokenStatus();

      // Check if we have a Monarch token
      const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);
      stateManager.setMonarchAuth(monarchToken);
    } catch (error) {
      debugLog('Error checking CanadaLife status:', error);
    }
  }

  /**
     * Initialize Rogers Bank application components
     */
  function initializeRogersBankApp() {
    try {
      debugLog('Initializing Rogers Bank application components...');

      // Set up credential interception
      setupCredentialInterception();

      // Initialize Rogers Bank UI
      initRogersBankUI()
        .then(() => debugLog('Rogers Bank UI initialized successfully'))
        .catch((err) => debugLog('Error initializing Rogers Bank UI:', err));
    } catch (error) {
      debugLog('Error initializing Rogers Bank application:', error);
    }
  }

  /**
     * Initialize MBNA application components
     */
  function initializeMbnaApp() {
    try {
      debugLog('Initializing MBNA application components...');

      // Initialize MBNA UI
      initMbnaUI()
        .then(() => debugLog('MBNA UI initialized successfully'))
        .catch((err) => debugLog('Error initializing MBNA UI:', err));
    } catch (error) {
      debugLog('Error initializing MBNA application:', error);
    }
  }

  /**
     * Initialize Wealthsimple application components
     */
  function initializeWealthsimpleApp() {
    try {
      debugLog('Initializing Wealthsimple application components...');

      // Set up token monitoring
      setupWealthsimpleTokenMonitoring();

      // Check auth status immediately
      checkWealthsimpleStatus();

      // Initialize Wealthsimple UI
      initWealthsimpleUI()
        .then(() => debugLog('Wealthsimple UI initialized successfully'))
        .catch((err) => debugLog('Error initializing Wealthsimple UI:', err));
    } catch (error) {
      debugLog('Error initializing Wealthsimple application:', error);
    }
  }

  /**
     * Check auth status for Wealthsimple
     */
  function checkWealthsimpleStatus() {
    try {
      // Check Wealthsimple auth status
      checkWealthsimpleAuth();

      // Check if we have a Monarch token
      const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);
      stateManager.setMonarchAuth(monarchToken);
    } catch (error) {
      debugLog('Error checking Wealthsimple status:', error);
    }
  }

  /**
     * Initialize Monarch token monitoring with event-driven detection
     */
  function initializeMonarchTokenMonitoring() {
    try {
      // Check initial Monarch token state
      const monarchToken = GM_getValue(STORAGE.MONARCH_TOKEN);
      stateManager.setMonarchAuth(monarchToken);

      // Set up storage event listener for Monarch token changes
      window.addEventListener('storage', (event) => {
        if (event.key === STORAGE.MONARCH_TOKEN) {
          debugLog('Monarch token changed via storage event');
          const newToken = GM_getValue(STORAGE.MONARCH_TOKEN);
          stateManager.setMonarchAuth(newToken);
        }
      });

      debugLog('Monarch token monitoring initialized');
    } catch (error) {
      debugLog('Error initializing Monarch token monitoring:', error);
    }
  }

  debugLog('Script loaded successfully');
}());
