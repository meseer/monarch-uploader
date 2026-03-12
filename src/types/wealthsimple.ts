/**
 * Wealthsimple Shared Domain Types
 * Cross-layer types used by services, UI, and API layers.
 *
 * Extracted to break circular dependency between account.ts ↔ balance.ts
 * and eliminate duplicate interface definitions across service files.
 *
 * @see docs/decisions/006-shared-type-system.md
 */

import type { BalanceCheckpoint } from './monarch';

// ── Account Types ───────────────────────────────────────────────────────────

/**
 * Core Wealthsimple account fields shared across all service modules.
 * The API layer's WealthsimpleApiAccount is the richer type with all API fields;
 * this is the minimal shape needed by service-layer code.
 */
export interface WealthsimpleAccountBase {
  id: string;
  nickname?: string;
  type?: string;
  currency?: string;
  createdAt?: string;
  [key: string]: unknown;
}

// ── Consolidated Account Types ──────────────────────────────────────────────

/**
 * Monarch account mapping reference stored in consolidated account entries.
 */
export interface MonarchAccountMapping {
  id: string;
  displayName?: string;
  [key: string]: unknown;
}

/**
 * Stored transaction entry for deduplication tracking.
 */
export interface StoredTransaction {
  id: string;
  date?: string;
}

/**
 * Base consolidated account structure shared across all Wealthsimple service modules.
 * This is the minimal shape that balance.ts, transactions.ts, and transactionsInvestment.ts
 * all agree on. The canonical full type with all fields lives in account.ts.
 */
export interface ConsolidatedAccountBase {
  wealthsimpleAccount: WealthsimpleAccountBase;
  monarchAccount?: MonarchAccountMapping | null;
  syncEnabled?: boolean;
  lastSyncDate?: string | null;
  uploadedTransactions?: StoredTransaction[];
  storeTransactionDetailsInNotes?: boolean;
  stripStoreNumbers?: boolean;
  includePendingTransactions?: boolean;
  skipCategorization?: boolean;
  transactionRetentionDays?: number;
  transactionRetentionCount?: number;
  balanceCheckpoint?: BalanceCheckpoint;
  lastSyncedCreditLimit?: number | null;
  [key: string]: unknown;
}