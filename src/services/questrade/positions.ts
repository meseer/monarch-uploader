/**
 * Questrade Positions Service
 *
 * Handles fetching, mapping, and synchronizing Questrade positions to Monarch holdings.
 *
 * Institution-specific logic lives here:
 * - Position fetching (Questrade API)
 * - Security mapping resolution (user prompts)
 * - Position data extraction (flat Questrade structure)
 *
 * Generic holding resolution/creation/deletion is delegated to the shared
 * holdingsSync orchestrator via HoldingsSyncHooks.
 */

import { debugLog } from '../../core/utils';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import questradeApi from '../../api/questrade';
import accountService from '../common/accountService';
import {
  processAccountPositions as genericProcessAccountPositions,
} from '../common/holdingsSync';
import { showMonarchSecuritySelector } from '../../ui/components/securitySelector';
import toast from '../../ui/toast';
import type { HoldingsSyncHooks, MonarchHoldingsData } from '../../integrations/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HoldingMapping {
  securityId?: string | null;
  holdingId?: string | null;
  symbol?: string | null;
}

// ── Error Class ───────────────────────────────────────────────────────────────

/**
 * Custom positions error class
 */
export class PositionsError extends Error {
  accountId: string | null;
  position: unknown;

  constructor(message: string, accountId: string | null, position: unknown = null) {
    super(message);
    this.name = 'PositionsError';
    this.accountId = accountId;
    this.position = position;
  }
}

// ── HoldingsSyncHooks Implementation ──────────────────────────────────────────

/**
 * Build Questrade HoldingsSyncHooks.
 * Provides QT-specific data extraction for the generic holdings sync orchestrator.
 */
export function buildQuestradeHoldingsHooks(): HoldingsSyncHooks {
  return {
    getPositionKey: (position) =>
      (position as Record<string, unknown>).securityUuid as string
      || (position as Record<string, unknown>).symbolId as string
      || undefined,

    getDisplaySymbol: (position) => {
      const sec = (position as Record<string, unknown>).security as Record<string, unknown> | undefined;
      return (sec?.symbol as string) || null;
    },

    getQuantity: (position) =>
      (position as Record<string, unknown>).openQuantity as number || 0,

    buildHoldingUpdate: (position) => {
      const updates: Record<string, unknown> = {
        quantity: (position as Record<string, unknown>).openQuantity || 0,
        costBasis: (position as Record<string, unknown>).averageEntryPrice
          || (position as Record<string, unknown>).averagePrice
          || 0,
      };

      const securityType = (position as Record<string, unknown>).securityType as string | undefined;
      if (securityType) {
        const typeMap: Record<string, string> = {
          Stock: 'equity',
          Option: 'option',
          Bond: 'bond',
          MutualFund: 'mutualFund',
          Index: 'index',
        };
        updates.securityType = typeMap[securityType] || 'equity';
      }

      return updates;
    },

    resolveSecurityMapping: (accountId, position) =>
      resolveSecurityMapping(accountId, position),

    getTickerForAutoRepair: (position) => {
      const sec = (position as Record<string, unknown>).security as Record<string, unknown> | undefined;
      return (sec?.symbol as string) || null;
    },

    getAutoRepairSourceId: (position) =>
      (position as Record<string, unknown>).securityUuid as string
      || (position as Record<string, unknown>).symbolId as string
      || null,
  };
}

// ── Questrade-Specific Functions ──────────────────────────────────────────────

/**
 * Fetch positions for a Questrade account
 */
export async function fetchPositions(accountId: string): Promise<Record<string, unknown>[]> {
  try {
    debugLog(`Fetching positions for account ${accountId}`);

    if (!accountId) {
      throw new PositionsError('Account ID is required', accountId);
    }

    const response = await questradeApi.fetchPositions(accountId);

    // Extract positions array from response
    const positions = (response as Record<string, unknown>)?.data || [];

    debugLog(`Fetched ${(positions as unknown[]).length} positions for account ${accountId}`);
    return Array.isArray(positions) ? positions as Record<string, unknown>[] : [];
  } catch (error: unknown) {
    debugLog(`Error fetching positions for account ${accountId}:`, error);
    throw new PositionsError(`Failed to fetch positions: ${(error as Error).message}`, accountId);
  }
}

/**
 * Resolve security mapping for a position
 */
export async function resolveSecurityMapping(accountId: string, position: Record<string, unknown>): Promise<string | null> {
  try {
    const securityUuid = position.securityUuid as string || position.symbolId as string;
    if (!securityUuid) {
      throw new PositionsError('Position missing security UUID', accountId, position);
    }

    const sec = position.security as Record<string, unknown> | undefined;

    // Check for existing mapping using accountService (unified structure)
    const existingMapping = accountService.getHoldingMapping(INTEGRATIONS.QUESTRADE, accountId, securityUuid) as HoldingMapping | null;
    if (existingMapping?.securityId) {
      debugLog(`Found existing security mapping for ${sec?.symbol}: ${existingMapping.securityId}`);
      return existingMapping.securityId;
    }

    debugLog(`No mapping found for ${sec?.symbol}, showing security selector`);

    // Show security selector to user
    const selectedSecurity = await new Promise<Record<string, unknown> | null>((resolve) => {
      showMonarchSecuritySelector(position, resolve as (result: unknown) => void);
    });

    if (!selectedSecurity) {
      debugLog(`User cancelled security selection for ${sec?.symbol}`);
      return null;
    }

    debugLog(`Selected security: ${sec?.symbol} (${securityUuid}) -> ${selectedSecurity.name} (${selectedSecurity.id})`);
    return selectedSecurity.id as string;
  } catch (error: unknown) {
    debugLog('Error resolving security mapping for position:', error);
    throw new PositionsError(`Failed to resolve security mapping: ${(error as Error).message}`, accountId, position);
  }
}

// ── Re-exports for backward compatibility ─────────────────────────────────────

export { findHoldingById } from '../common/holdingsSync';

/**
 * Resolve or create holding for a position (delegates to shared holdingsSync)
 */
export async function resolveOrCreateHolding(
  accountId: string,
  monarchAccountId: string,
  securityId: string,
  position: Record<string, unknown>,
  holdings: MonarchHoldingsData | null,
): Promise<string> {
  const { resolveOrCreateHolding: genericResolve } = await import('../common/holdingsSync');
  const hooks = buildQuestradeHoldingsHooks();
  return genericResolve(
    INTEGRATIONS.QUESTRADE, accountId, monarchAccountId, securityId,
    position, holdings, hooks,
  );
}

/**
 * Sync position data to Monarch holding (delegates to shared holdingsSync)
 */
export async function syncPositionToHolding(holdingId: string, position: Record<string, unknown>): Promise<void> {
  const { syncPositionToHolding: genericSync } = await import('../common/holdingsSync');
  const hooks = buildQuestradeHoldingsHooks();
  return genericSync(holdingId, position, hooks);
}

/**
 * Detect and remove deleted holdings (delegates to shared holdingsSync)
 */
export async function detectAndRemoveDeletedHoldings(
  accountId: string,
  monarchAccountId: string,
  currentPositions: Record<string, unknown>[],
): Promise<{ deleted: number; autoRepaired: number }> {
  const { detectAndRemoveDeletedHoldings: genericDetect } = await import('../common/holdingsSync');
  const hooks = buildQuestradeHoldingsHooks();
  return genericDetect(
    INTEGRATIONS.QUESTRADE, accountId, monarchAccountId,
    currentPositions, hooks,
  );
}

/**
 * Process positions for a single account (uses shared holdingsSync orchestrator)
 */
export async function processAccountPositions(
  accountId: string,
  accountName: string,
  monarchAccountId: string,
  progressDialog: { updateProgress: (accountId: string, status: string, message: string) => void } | null = null,
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {
    success: false,
    positionsProcessed: 0,
    positionsSkipped: 0,
    holdingsRemoved: 0,
    mappingsAutoRepaired: 0,
    error: null,
  };

  try {
    debugLog(`Processing positions for account ${accountName} (${accountId})`);
    toast.show(`Starting positions sync for ${accountName}...`, 'info');

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Fetching positions...');
    }

    const positions = await fetchPositions(accountId);

    if (!positions || positions.length === 0) {
      debugLog(`No positions found for account ${accountId}`);
      toast.show(`No positions found for ${accountName}`, 'debug');
      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'success', 'No positions to sync');
      }
      result.success = true;
      return result;
    }

    debugLog(`Found ${positions.length} positions to process`);

    // Adapt the progress dialog to the HoldingsSyncProgress interface
    const progress = progressDialog ? {
      updateStatus: (status: string, message: string) => {
        progressDialog.updateProgress(accountId, status, message);
      },
    } : null;

    // Delegate to shared orchestrator
    const hooks = buildQuestradeHoldingsHooks();
    const syncResult = await genericProcessAccountPositions(
      INTEGRATIONS.QUESTRADE, accountId, monarchAccountId,
      positions, hooks, progress,
    );

    // Copy results
    result.success = syncResult.success;
    result.positionsProcessed = syncResult.positionsProcessed;
    result.positionsSkipped = syncResult.positionsSkipped;
    result.holdingsRemoved = syncResult.holdingsRemoved;
    result.mappingsAutoRepaired = syncResult.mappingsAutoRepaired;
    result.error = syncResult.error;

    // Show completion toast
    if (syncResult.success) {
      let statusMsg = `Synced ${result.positionsProcessed} positions`;
      if ((result.mappingsAutoRepaired as number) > 0) {
        statusMsg += `, repaired ${result.mappingsAutoRepaired} mappings`;
      }
      if ((result.holdingsRemoved as number) > 0) {
        statusMsg += `, removed ${result.holdingsRemoved} deleted`;
      }

      if (progressDialog) {
        progressDialog.updateProgress(accountId, 'success', statusMsg);
      }

      const toastParts = [`Synced ${result.positionsProcessed} positions for ${accountName}`];
      if ((result.positionsSkipped as number) > 0) toastParts.push(`${result.positionsSkipped} skipped`);
      if ((result.mappingsAutoRepaired as number) > 0) toastParts.push(`${result.mappingsAutoRepaired} repaired`);
      if ((result.holdingsRemoved as number) > 0) toastParts.push(`${result.holdingsRemoved} deleted`);

      const toastMsg = toastParts.length > 1
        ? `${toastParts[0]} (${toastParts.slice(1).join(', ')})`
        : toastParts[0];
      toast.show(toastMsg, 'info');
    }

    debugLog(`Completed processing positions for ${accountName}: ${result.positionsProcessed} processed, ${result.positionsSkipped} skipped, ${result.mappingsAutoRepaired} repaired, ${result.holdingsRemoved} deleted`);
  } catch (error: unknown) {
    debugLog(`Error processing account positions for ${accountId}:`, error);
    result.error = (error as Error).message;
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'error', `Error: ${(error as Error).message}`);
    }
  }

  return result;
}

// Default export
export default {
  fetchPositions,
  resolveSecurityMapping,
  resolveOrCreateHolding,
  syncPositionToHolding,
  detectAndRemoveDeletedHoldings,
  processAccountPositions,
  PositionsError,
  buildQuestradeHoldingsHooks,
};