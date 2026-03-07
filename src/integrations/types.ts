/**
 * Integration Module Type Definitions
 *
 * Native TypeScript interfaces defining the standard contract that every
 * integration module must implement. These types are the contract between
 * integration modules and the core orchestrator.
 *
 * Integration modules are self-contained API libraries for financial
 * institutions. They are Tampermonkey-agnostic — all platform-specific
 * capabilities (HTTP requests, storage) are injected via adapters.
 *
 * @module integrations/types
 */

// ============================================================
// ADAPTER INTERFACES (re-exported from canonical core locations)
// ============================================================

import type { HttpClient, HttpRequestOptions, HttpResponse } from '../core/httpClient';
import type { StorageAdapter } from '../core/storageAdapter';

export type { HttpClient, HttpRequestOptions, HttpResponse };
export type { StorageAdapter };

// ============================================================
// MANIFEST
// ============================================================

/**
 * Declares everything the core needs to know about an integration
 * without instantiating any of its components.
 */
export interface IntegrationManifest {
  /** Unique integration identifier (e.g., 'wealthsimple') */
  id: string;
  /** Human-readable name (e.g., 'Wealthsimple') */
  displayName: string;
  /** Domain for Google Favicon API (e.g., 'wealthsimple.com') */
  faviconDomain: string;

  /** Hostname fragments for site detection (e.g., ['wealthsimple.com']) */
  matchDomains: string[];
  /** Full @match patterns for userscript metadata */
  matchUrls: string[];

  /** Storage key configuration */
  storageKeys: IntegrationStorageKeys;
  /** Schema for the consolidated config object */
  configSchema: IntegrationConfigSchema;

  /** Feature flags */
  capabilities: IntegrationCapabilities;
  /** Category mapping configuration (null if no categorization) */
  categoryConfig: IntegrationCategoryConfig | null;

  /** Prefix for generated pending transaction IDs. Required if hasDeduplication + pending support. */
  txIdPrefix?: string | null;

  /** Key name for source account in consolidated storage (e.g., 'wealthsimpleAccount') */
  accountKeyName: string;
  /** Per-account settings with defaults */
  settings: IntegrationSettingDefinition[];

  /** Default lookback period in days */
  defaultLookbackDays?: number;

  /** Account creation defaults for new Monarch accounts */
  accountCreateDefaults?: IntegrationAccountCreateDefaults;

  /** CSS color for brand theming */
  brandColor: string;
  /** Cloudinary public ID for institution logo (null if none) */
  logoCloudinaryId: string | null;

  /** Optional UI extension flags */
  uiExtensions: IntegrationUIExtensions;
}

export interface IntegrationStorageKeys {
  /** Key for the consolidated accounts list */
  accountsList: string;
  /** Key for the consolidated config object */
  config: string;
  /** Key for volatile/regenerable cache data (optional) */
  cache?: string | null;
}

/**
 * Describes the shape of the consolidated config object stored
 * under storageKeys.config.
 */
export interface IntegrationConfigSchema {
  /** List of auth-related field names stored in config.auth */
  auth: string[];
  /** List of global setting field names stored in config.settings */
  settings: string[];
  /** Whether config stores category mappings */
  hasCategoryMappings: boolean;
  /** Whether config stores institution-level holdings mappings */
  hasHoldingsMappings: boolean;
}

/** Feature flags indicating what the integration supports. */
export interface IntegrationCapabilities {
  /** Supports transaction upload */
  hasTransactions: boolean;
  /** Needs transaction deduplication */
  hasDeduplication: boolean;
  /** Supports balance history upload */
  hasBalanceHistory: boolean;
  /** Supports credit limit sync */
  hasCreditLimit: boolean;
  /** Supports holdings/positions sync */
  hasHoldings: boolean;
  /** Balance can be reconstructed from transactions */
  hasBalanceReconstruction: boolean;
  /** Supports category mappings (merchant → Monarch category) */
  hasCategorization: boolean;
}

export interface IntegrationCategoryConfig {
  /** Label for the source column in category mapping UI */
  sourceLabel: string;
}

/** Defines a per-account setting available for this integration. */
export interface IntegrationSettingDefinition {
  /** Setting key (e.g., 'storeTransactionDetailsInNotes') */
  key: string;
  /** Default value for new accounts */
  default: unknown;
}

/** Defaults used when creating new Monarch accounts for this integration. */
export interface IntegrationAccountCreateDefaults {
  defaultType: string;
  defaultSubtype: string;
  accountType: string;
}

/** Optional flags for UI features beyond the standard panel. */
export interface IntegrationUIExtensions {
  /** Show token expiry countdown in status */
  showTokenExpiry?: boolean;
  /** Show dev-mode testing section */
  showTestingSection?: boolean;
}

// ============================================================
// INJECTION POINT
// ============================================================

/**
 * Configuration for how and where to inject the uploader UI
 * on the institution's website.
 */
export interface IntegrationInjectionPoint {
  /** CSS selectors tried in order to find injection target */
  selectors: InjectionSelector[];
  /** Whether the site is a SPA requiring MutationObserver monitoring */
  isSPA: boolean;
  /** Page modes defining what UI to show based on URL */
  pageModes: PageMode[];
  /** URL patterns indicating valid app pages */
  appPagePatterns: RegExp[];
  /** URL patterns to skip (login, loading screens) */
  skipPatterns: RegExp[];
  /** DOM ID for the injected UI container */
  containerId: string;
}

export interface InjectionSelector {
  /** CSS selector to find the target element */
  selector: string;
  /** How to insert: 'prepend', 'append', 'insertBefore', 'prependToSecondChild' */
  insertMethod: string;
}

export interface PageMode {
  /** Unique mode identifier (e.g., 'single-account', 'all-accounts') */
  id: string;
  /** URL pattern to match for this mode */
  urlPattern: RegExp;
  /** Optional function: (regexMatch) => accountId string */
  extractAccountId?: (match: RegExpMatchArray) => string;
  /** UI type to render: 'single-account' or 'all-accounts' */
  uiType: string;
  /** Per-page-mode CSS selectors (overrides global selectors) */
  selectors?: InjectionSelector[];
}

// ============================================================
// API CLIENT
// ============================================================

/**
 * Institution API client. All methods return raw institution data —
 * no Monarch-specific transformation happens here.
 *
 * Not all methods are required; presence depends on capabilities.
 */
export interface IntegrationApi {
  /** Fetch all accounts */
  getAccounts(): Promise<Record<string, unknown>[]>;
  /** Fetch current balance for an account */
  getBalance?(accountId: string): Promise<Record<string, unknown>>;
  /** Fetch balance history (accountId, startDate, endDate) */
  getBalanceHistory?(accountId: string, startDate: string, endDate: string): Promise<Record<string, unknown>[]>;
  /** Fetch transactions (accountId, startDate, endDate) */
  getTransactions?(accountId: string, startDate: string, endDate: string): Promise<Record<string, unknown>[]>;
  /** Fetch positions/holdings for an account */
  getPositions?(accountId: string): Promise<Record<string, unknown>[]>;
  /** Fetch credit limit for an account */
  getCreditLimit?(accountId: string): Promise<number | null>;
}

/** Factory function for creating an API client. */
export type CreateApiFunction = (
  httpClient: HttpClient,
  storage: StorageAdapter,
) => IntegrationApi;

// ============================================================
// AUTH HANDLER
// ============================================================

/**
 * Handles credential/token capture and monitoring for the institution.
 */
export interface IntegrationAuth {
  /** Start token/credential monitoring */
  setupMonitoring(): void;
  /** Check current auth status, returns auth info object */
  checkStatus(): Record<string, unknown>;
  /** Get current credentials/token for API calls */
  getCredentials(): Record<string, unknown> | null;
  /** Clear stored credentials */
  clearCredentials(): void;
  /** Interval (ms) for periodic auth checks, or null for event-driven */
  pollingInterval: number | null;
}

/** Factory function for creating an auth handler. */
export type CreateAuthFunction = (
  storage: StorageAdapter,
) => IntegrationAuth;

// ============================================================
// ENRICHMENT FETCHER
// ============================================================

/**
 * Fetches supplementary data for transactions that the basic
 * transaction list doesn't include.
 */
export interface IntegrationEnrichment {
  /**
   * Fetch enrichment data for transactions.
   * Returns: Map keyed by transaction externalCanonicalId.
   */
  fetchEnrichmentData(
    transactions: Record<string, unknown>[],
    options?: { onProgress?: (stepName: string, current: number, total: number) => void },
  ): Promise<Map<string, unknown>>;
}

/** Factory function for creating an enrichment fetcher. */
export type CreateEnrichmentFunction = (
  api: IntegrationApi,
) => IntegrationEnrichment;

// ============================================================
// MONARCH MAPPER (sink-specific data transformation)
// ============================================================

/**
 * Transforms raw institution data into Monarch-compatible format.
 * Explicitly coupled to Monarch's data model.
 */
export interface IntegrationMonarchMapper {
  /**
   * Apply matching rule to transform a raw transaction.
   * Returns transformed object or null if no rule matches.
   */
  applyTransactionRule(
    rawTransaction: Record<string, unknown>,
    enrichmentMap?: Map<string, unknown>,
  ): Record<string, unknown> | null;

  /**
   * Quick check if a rule exists for a transaction type/subType combination.
   */
  hasRuleForTransaction?(type: string, subType: string): boolean;
}

// ============================================================
// INTEGRATION MODULE (barrel export shape)
// ============================================================

/**
 * The shape of an integration module's barrel export (index.js/ts).
 * This is what `src/integrations/index.js` imports for each integration.
 */
export interface IntegrationModule {
  /** Integration manifest */
  manifest: IntegrationManifest;
  /** Factory for API client */
  createApi: CreateApiFunction;
  /** Factory for auth handler */
  createAuth: CreateAuthFunction;
  /** Factory for enrichment fetcher (optional) */
  createEnrichment?: CreateEnrichmentFunction;
  /** UI injection point config */
  injectionPoint: IntegrationInjectionPoint;
  /** Monarch data mapper (optional) */
  monarchMapper?: IntegrationMonarchMapper;
  /** Sync hooks for the generic syncOrchestrator (optional) */
  syncHooks?: SyncHooks;
}

// ============================================================
// SYNC HOOKS (orchestrator contract)
// ============================================================

/** Progress callbacks passed to sync hooks. */
export interface SyncCallbacks {
  onProgress: (message: string) => void;
}

/**
 * Minimal set of institution-specific hooks that the generic
 * syncOrchestrator calls during the sync workflow.
 *
 * Everything generic (CSV generation, filename, balance sign,
 * dedup filtering, reconciliation algorithm, upload) stays in
 * the orchestrator or common services. Only truly institution-
 * specific logic is exposed as hooks.
 */
export interface SyncHooks {
  // Required hooks
  /** Fetch raw transactions from institution API */
  fetchTransactions: FetchTransactionsHook;
  /** Normalize raw transactions into orchestrator-compatible shape */
  processTransactions: ProcessTransactionsHook;
  /** Extract dedup reference ID from a settled transaction */
  getSettledRefId: GetSettledRefIdHook;
  /** Extract dedup reference ID from a pending transaction */
  getPendingRefId: GetPendingRefIdHook;
  /** Resolve Monarch categories for transactions */
  resolveCategories: ResolveCategoriesHook;
  /** Build notes string for a transaction CSV row */
  buildTransactionNotes: BuildTransactionNotesHook;

  // Optional hooks (capability-dependent)
  /** Stable fields for pending transaction ID hashing */
  getPendingIdFields?: GetPendingIdFieldsHook;
  /** Get Monarch-normalized settled amount from a raw institution transaction */
  getSettledAmount?: (settledTx: Record<string, unknown>) => number;
  /** Build balance history for first-sync reconstruction */
  buildBalanceHistory?: BuildBalanceHistoryHook;
  /** Suggest a default start date for first sync */
  suggestStartDate?: SuggestStartDateHook;
  /** Build the institution-specific account storage shape */
  buildAccountEntry?: BuildAccountEntryHook;
}

/** Fetch raw transactions from the institution API. */
export type FetchTransactionsHook = (
  api: IntegrationApi,
  accountId: string,
  fromDate: string,
  callbacks: SyncCallbacks,
) => Promise<{ settled: unknown[]; pending: unknown[]; metadata: Record<string, unknown> }>;

/**
 * Process raw transactions into a normalized shape for the orchestrator.
 *
 * Each returned transaction MUST have these fields:
 *   { date, merchant, originalStatement, amount, referenceNumber,
 *     isPending, pendingId, autoCategory }
 */
export type ProcessTransactionsHook = (
  settled: unknown[],
  pending: unknown[],
  options: { includePending: boolean },
) => { settled: unknown[]; pending: unknown[] };

/** Extract the dedup reference ID from a settled transaction. */
export type GetSettledRefIdHook = (tx: Record<string, unknown>) => string;

/** Extract the dedup reference ID from a pending transaction. */
export type GetPendingRefIdHook = (tx: Record<string, unknown>) => string;

/** Resolve Monarch categories for transactions. */
export type ResolveCategoriesHook = (
  transactions: unknown[],
  accountId: string,
) => Promise<unknown[]>;

/** Build the notes string for a single transaction's CSV row. */
export type BuildTransactionNotesHook = (
  tx: Record<string, unknown>,
  options: { storeTransactionDetailsInNotes: boolean },
) => string;

/**
 * Get the set of stable field values to hash for pending transaction ID generation.
 */
export type GetPendingIdFieldsHook = (tx: Record<string, unknown>) => string[];

/**
 * Build balance history from statement/transaction data for first-sync reconstruction.
 */
export type BuildBalanceHistoryHook = (params: {
  currentBalance: number;
  metadata: Record<string, unknown>;
  fromDate: string;
  invertBalance: boolean;
}) => Array<{ date: string; amount: number }> | null;

/** Suggest a start date for the first sync of an account. */
export type SuggestStartDateHook = (
  api: IntegrationApi,
  accountId: string,
) => Promise<{ date: string; description: string } | null>;

/** Build the institution-specific portion of the account storage entry. */
export type BuildAccountEntryHook = (
  account: Record<string, unknown>,
) => Record<string, unknown>;