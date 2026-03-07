/**
 * Data Sink Type Definitions
 *
 * Native TypeScript interfaces defining the standard interface that every
 * data sink (destination) must implement. A data sink receives normalized
 * financial data and persists it to a specific platform.
 *
 * The first implementation is Monarch Money. Future sinks could include
 * Actual Budget, a custom backend, or any other financial data destination.
 *
 * @module sinks/types
 */

import type { HttpClient, StorageAdapter } from '../integrations/types';

// ============================================================
// DATA SINK INTERFACE
// ============================================================

/**
 * A pluggable data destination that receives financial data from
 * the sync orchestrator and persists it to a specific platform.
 */
export interface DataSink {
  /** Unique sink identifier (e.g., 'monarch') */
  id: string;
  /** Human-readable name (e.g., 'Monarch Money') */
  displayName: string;

  // Authentication
  /** Check if authenticated with the sink */
  checkAuth(): Promise<boolean>;
  /** Set up token/auth capture (e.g., on the sink's website) */
  setupTokenCapture(): void;
  /** Get current auth token */
  getToken(): string | null;

  // Account operations
  /** Get all accounts from the sink */
  getAccounts(): Promise<SinkAccount[]>;
  /** Create a new account in the sink */
  createAccount(options: Record<string, unknown>): Promise<SinkAccount>;

  // Balance operations
  /** Upload balance history CSV (sinkAccountId, csvData) → upload result */
  uploadBalanceHistory(sinkAccountId: string, csvData: string): Promise<Record<string, unknown>>;
  /** Update current balance for an account */
  updateBalance(sinkAccountId: string, balance: number): Promise<void>;

  // Transaction operations
  /** Upload transactions CSV (sinkAccountId, csvData) → upload result */
  uploadTransactions(sinkAccountId: string, csvData: string): Promise<Record<string, unknown>>;

  // Holdings operations
  /** Get all holdings for an account */
  getHoldings(sinkAccountId: string): Promise<SinkHolding[]>;
  /** Create or update a holding */
  upsertHolding(sinkAccountId: string, holdingData: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Search/list securities available in the sink */
  getSecurities(query: string): Promise<SinkSecurity[]>;

  // Category operations
  /** Get all categories and category groups from the sink */
  getCategories(): Promise<SinkCategory[]>;

  // Credit limit
  /** Update credit limit for an account */
  updateCreditLimit(sinkAccountId: string, limit: number): Promise<void>;
}

// ============================================================
// SINK DATA TYPES
// ============================================================

/** An account in the data sink. */
export interface SinkAccount {
  /** Sink-specific account ID */
  id: string;
  /** Account display name */
  displayName: string;
  /** Account type (e.g., 'checking', 'investment', 'credit_card') */
  type?: string;
  /** Account subtype */
  subtype?: string;
  /** Current balance */
  balance?: number;
  /** Institution name */
  institution?: string;
  /** Account logo URL */
  logoUrl?: string;
}

/** A security holding in the data sink. */
export interface SinkHolding {
  /** Sink-specific holding ID */
  id: string;
  /** Sink-specific security ID */
  securityId: string;
  /** Ticker symbol */
  symbol?: string;
  /** Security name */
  name?: string;
  /** Number of shares/units */
  quantity?: number;
  /** Current market value */
  value?: number;
  /** Cost basis */
  costBasis?: number;
}

/** A security available in the data sink. */
export interface SinkSecurity {
  /** Sink-specific security ID */
  id: string;
  /** Ticker symbol */
  symbol: string;
  /** Security name */
  name: string;
  /** Security type (e.g., 'stock', 'etf', 'mutual_fund') */
  type?: string;
  /** Exchange name */
  exchange?: string;
}

/** A transaction category in the data sink. */
export interface SinkCategory {
  /** Sink-specific category ID */
  id: string;
  /** Category name */
  name: string;
  /** Category group name */
  group?: string;
  /** Category icon */
  icon?: string;
}

// ============================================================
// FACTORY
// ============================================================

/** Factory function for creating a data sink. */
export type CreateSinkFunction = (
  httpClient: HttpClient,
  storage: StorageAdapter,
) => DataSink;