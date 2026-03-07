/**
 * State management for the Questrade to Monarch balance uploader
 * This will eventually replace global variables in the original script
 */

import { debugLog } from './utils';

// ============================================================
// State shape interfaces
// ============================================================

interface AccountState {
  id: string | null;
  nickname: string;
}

interface UIIndicators {
  questrade: HTMLElement | null;
  questradeExpiry: HTMLElement | null;
  monarch: HTMLElement | null;
  lastDownloadedNote: HTMLElement | null;
}

interface UIState {
  buttonContainer: HTMLElement | null;
  indicators: UIIndicators;
}

interface QuestradeAuth {
  token: string | null;
  expiresAt: number;
}

interface MonarchAuth {
  token: string | null;
}

interface CanadaLifeAuth {
  token: string | null;
}

interface RogersBankAuth {
  credentials: Record<string, unknown> | null;
}

interface WealthsimpleAuth {
  authenticated: boolean;
  identityId: string | null;
  expiresAt: number | null;
}

interface AuthState {
  questrade: QuestradeAuth;
  monarch: MonarchAuth;
  canadalife: CanadaLifeAuth;
  rogersbank: RogersBankAuth;
  wealthsimple: WealthsimpleAuth;
}

interface AppState {
  currentAccount: AccountState;
  ui: UIState;
  auth: AuthState;
}

type StateChangeCallback = (newState: AppState, prevState: AppState) => void;

// ============================================================
// StateManager class
// ============================================================

/**
 * Central state manager to maintain application state
 */
class StateManager {
  private state: AppState;
  private listeners: Record<string, StateChangeCallback[]>;

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
        rogersbank: {
          credentials: null,
        },
        wealthsimple: {
          authenticated: false,
          identityId: null,
          expiresAt: null,
        },
      },
    };

    // Event listeners for state changes
    this.listeners = {};

    debugLog('StateManager initialized');
  }

  /**
   * Get current state
   */
  getState(): AppState {
    return { ...this.state };
  }

  /**
   * Update account information
   */
  setAccount(id: string | null, nickname: string): void {
    const prevState = { ...this.state };
    this.state.currentAccount = { id, nickname };

    // During transition, keep global variables in sync
    // This can be removed once refactoring is complete
    (window as unknown as Record<string, unknown>).currentAccountId = id;
    (window as unknown as Record<string, unknown>).currentAccountName = nickname;

    this.notifyListeners('account', prevState, this.state);
  }

  /**
   * Update UI elements references
   */
  setUiElement(elementName: string, element: HTMLElement): void {
    const prevState = { ...this.state };

    if (elementName === 'buttonContainer') {
      this.state.ui.buttonContainer = element;
    } else if (Object.keys(this.state.ui.indicators).includes(elementName)) {
      (this.state.ui.indicators as unknown as Record<string, HTMLElement | null>)[elementName] = element;
    } else {
      debugLog(`Warning: Unknown UI element "${elementName}"`);
    }

    this.notifyListeners('ui', prevState, this.state);
  }

  /**
   * Update Questrade authentication token
   */
  setQuestradeAuth(tokenInfo: { token: string; expires_at: number } | null): void {
    const prevState = { ...this.state };
    this.state.auth.questrade = {
      token: tokenInfo ? tokenInfo.token : null,
      expiresAt: tokenInfo ? tokenInfo.expires_at * 1000 : 0,
    };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Update Monarch authentication token
   */
  setMonarchAuth(token: string | null): void {
    const prevState = { ...this.state };
    this.state.auth.monarch = { token };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Update CanadaLife authentication token
   */
  setCanadaLifeAuth(token: string | null): void {
    const prevState = { ...this.state };
    this.state.auth.canadalife = { token };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Update Rogers Bank authentication credentials
   */
  setRogersBankAuth(credentials: Record<string, unknown> | null): void {
    const prevState = { ...this.state };
    this.state.auth.rogersbank = { credentials };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Update Wealthsimple authentication status
   */
  setWealthsimpleAuth(authInfo: WealthsimpleAuth | null): void {
    const prevState = { ...this.state };
    this.state.auth.wealthsimple = authInfo || {
      authenticated: false,
      identityId: null,
      expiresAt: null,
    };

    this.notifyListeners('auth', prevState, this.state);
  }

  /**
   * Add listener for state changes
   * @returns Function to remove the listener
   */
  addListener(type: string, callback: StateChangeCallback): () => void {
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
   */
  private notifyListeners(type: string, prevState: AppState, newState: AppState): void {
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

// Export state interfaces for external use
export type { AppState, AccountState, AuthState, WealthsimpleAuth, UIState, StateChangeCallback };