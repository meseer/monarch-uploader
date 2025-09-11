/**
 * State management for the Questrade to Monarch balance uploader
 * This will eventually replace global variables in the original script
 */

import { debugLog } from './utils';

/**
 * Central state manager to maintain application state
 */
class StateManager {
  constructor() {
    this.state = {
      // Current account context
      currentAccount: {
        id: null,
        nickname: 'unknown',
      },

      // UI elements
      ui: {
        buttonContainer: null,
        indicators: {
          questrade: null,
          questradeExpiry: null,
          monarch: null,
          lastDownloadedNote: null,
        },
      },

      // Auth state
      auth: {
        questrade: {
          token: null,
          expiresAt: 0,
        },
        monarch: {
          token: null,
        },
        canadalife: {
          token: null,
        },
      },
    };

    // Event listeners for state changes
    this.listeners = {};

    debugLog('StateManager initialized');
  }

  /**
   * Get current state
   * @returns {Object} Current state object
   */
  getState() {
    return { ...this.state };
  }

  /**
   * Update account information
   * @param {string} id - Account ID
   * @param {string} nickname - Account nickname
   */
  setAccount(id, nickname) {
    const prevState = { ...this.state };
    this.state.currentAccount = { id, nickname };

    // During transition, keep global variables in sync
    // This can be removed once refactoring is complete
    window.currentAccountId = id;
    window.currentAccountName = nickname;

    this.notifyListeners('account', prevState, this.state);
  }

  /**
   * Update UI elements references
   * @param {string} elementName - Name of the UI element
   * @param {HTMLElement} element - DOM element reference
   */
  setUiElement(elementName, element) {
    const prevState = { ...this.state };

    if (elementName === 'buttonContainer') {
      this.state.ui.buttonContainer = element;
    } else if (Object.keys(this.state.ui.indicators).includes(elementName)) {
      this.state.ui.indicators[elementName] = element;
    } else {
      debugLog(`Warning: Unknown UI element "${elementName}"`);
    }

    this.notifyListeners('ui', prevState, this.state);
  }

  /**
   * Update Questrade authentication token
   * @param {Object} tokenInfo - Token information object
   * @param {string} tokenInfo.token - The auth token
   * @param {number} tokenInfo.expires_at - Expiry timestamp
   */
  setQuestradeAuth(tokenInfo) {
    const prevState = { ...this.state };
    this.state.auth.questrade = {
      token: tokenInfo ? tokenInfo.token : null,
      expiresAt: tokenInfo ? tokenInfo.expires_at * 1000 : 0,
    };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Update Monarch authentication token
   * @param {string} token - Monarch auth token
   */
  setMonarchAuth(token) {
    const prevState = { ...this.state };
    this.state.auth.monarch = { token };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Update CanadaLife authentication token
   * @param {string} token - CanadaLife auth token
   */
  setCanadaLifeAuth(token) {
    const prevState = { ...this.state };
    this.state.auth.canadalife = { token };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Add listener for state changes
   * @param {string} type - State type to listen for (e.g., 'account', 'auth', 'ui', or '*' for all)
   * @param {Function} callback - Callback function
   * @returns {Function} Function to remove the listener
   */
  addListener(type, callback) {
    if (!this.listeners[type]) {
      this.listeners[type] = [];
    }

    this.listeners[type].push(callback);

    // Return function to remove this listener
    return () => {
      this.listeners[type] = this.listeners[type].filter((cb) => cb !== callback);
    };
  }

  /**
   * Notify all registered listeners about state changes
   * @param {string} type - Type of state change
   * @param {Object} prevState - Previous state
   * @param {Object} newState - New state
   * @private
   */
  notifyListeners(type, prevState, newState) {
    // Call specific listeners
    if (this.listeners[type]) {
      this.listeners[type].forEach((callback) => callback(newState, prevState));
    }

    // Call wildcard listeners
    if (this.listeners['*']) {
      this.listeners['*'].forEach((callback) => callback(newState, prevState));
    }
  }
}

// Create singleton instance
const stateManager = new StateManager();

// Export the singleton instance as default
export default stateManager;

// Also export the StateManager class for testing
export { StateManager };
