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
import stateManager from './core/state';
import navigationManager from './core/navigation';

// Import API clients
import { checkTokenStatus } from './api/questrade';
import monarchApi from './api/monarch';
import { setupTokenMonitoring, checkTokenStatus as checkCanadaLifeTokenStatus } from './api/canadalife';
import { setupCredentialInterception } from './api/rogersbank';
import { setupTokenMonitoring as setupWealthsimpleTokenMonitoring, checkAuth as checkWealthsimpleAuth } from './api/wealthsimple';

// Import UI components
import toast from './ui/toast';
import { initUI, updateStatusIndicators } from './ui/questrade/uiManager';
import { initCanadaLifeUI } from './ui/canadalife/uiManager';
import { initRogersBankUI } from './ui/rogersbank/uiManager';
import { initWealthsimpleUI } from './ui/wealthsimple/uiManager';
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
     * Initialize CanadaLife application components
     */
  function initializeCanadaLifeApp() {
    try {
      debugLog('Initializing CanadaLife application components...');

      // Set up token monitoring
      setupTokenMonitoring();

      // Check auth status immediately
      checkCanadaLifeStatus();

      // Initialize CanadaLife UI
      initCanadaLifeUI()
        .then(() => debugLog('CanadaLife UI initialized successfully'))
        .catch((err) => debugLog('Error initializing CanadaLife UI:', err));
    } catch (error) {
      debugLog('Error initializing CanadaLife application:', error);
    }
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
