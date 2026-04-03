/**
 * Holdings Sync Orchestrator
 *
 * Generic holdings/positions sync engine that drives the holding resolution,
 * creation, update, and deletion workflow using integration-provided
 * HoldingsSyncHooks.
 *
 * Follows the same pattern as syncOrchestrator.ts: the orchestrator owns
 * all generic logic; only institution-specific data extraction is injected
 * via hooks.
 *
 * Generic logic owned by this module:
 * - findHoldingById: validate stored holdingId against Monarch holdings
 * - findExistingHolding: find manual holding by securityId
 * - resolveOrCreateHolding: validate → find → create → save mapping
 * - syncPositionToHolding: update holding via Monarch API
 * - detectAndRemoveDeletedHoldings: delete orphans, auto-repair mappings
 * - processAccountPositions: top-level orchestration loop
 *
 * Institution-specific logic injected via HoldingsSyncHooks:
 * - getPositionKey, getDisplaySymbol, getQuantity, buildHoldingUpdate
 * - resolveSecurityMapping (handles auto-mapping, crypto, cash, user prompts)
 * - getTickerForAutoRepair, getAutoRepairSourceId (optional)
 *
 * When WS/QT are migrated to the modular architecture, this module
 * can be wired into syncOrchestrator.ts as an additional sync step.
 *
 * @module services/common/holdingsSync
 */

import { debugLog } from '../../core/utils';
import monarchApi from '../../api/monarch';
import accountService from './accountService';
import type {
  HoldingsSyncHooks,
  HoldingsSyncResult,
  HoldingsSyncProgress,
  MonarchHoldingsData,
} from '../../integrations/types';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HoldingMapping {
  securityId?: string | null;
  holdingId?: string | null;
  symbol?: string | null;
}

interface MonarchHolding {
  id: string;
  ticker?: string;
  isManual?: boolean;
}

// ── Pure Functions (no side effects, easily testable) ─────────────────────────

/**
 * Find a holding by its ID in Monarch holdings data (in-memory search, no API call).
 * Used to validate that a stored holdingId still exists in Monarch.
 *
 * @param holdingId - Holding ID to find
 * @param holdings - Holdings data from monarchApi.getHoldings()
 * @returns Holding object if found, null otherwise
 */
export function findHoldingById(holdingId: string, holdings: MonarchHoldingsData | null): MonarchHolding | null {
  if (!holdings?.aggregateHoldings?.edges) {
    return null;
  }

  for (const edge of holdings.aggregateHoldings.edges) {
    const aggregateHolding = edge.node;
    if (!aggregateHolding.holdings || !Array.isArray(aggregateHolding.holdings)) {
      continue;
    }
    for (const holding of aggregateHolding.holdings) {
      if (holding.id === holdingId) {
        return holding;
      }
    }
  }

  return null;
}

/**
 * Find an existing manual holding for a security in Monarch account.
 * Searches through aggregate holdings to find one matching the given securityId,
 * then returns its first manual holding.
 *
 * @param securityId - Monarch security ID to match
 * @param holdings - Holdings data from monarchApi.getHoldings()
 * @returns Manual holding object if found, null otherwise
 */
export function findExistingHolding(securityId: string, holdings: MonarchHoldingsData | null): MonarchHolding | null {
  if (!holdings?.aggregateHoldings?.edges) {
    return null;
  }

  for (const edge of holdings.aggregateHoldings.edges) {
    const aggregateHolding = edge.node;

    if (aggregateHolding.security && aggregateHolding.security.id === securityId) {
      if (aggregateHolding.holdings && Array.isArray(aggregateHolding.holdings)) {
        const manualHolding = aggregateHolding.holdings.find((h) => h.isManual);
        if (manualHolding) {
          return manualHolding;
        }
      }
    }
  }

  return null;
}

// ── Core Orchestration Functions ──────────────────────────────────────────────

/**
 * Resolve or create a holding for a position.
 *
 * Algorithm:
 * 1. Check stored mapping for holdingId
 * 2. If stored holdingId exists, validate it against current Monarch holdings
 * 3. If invalid/missing, search for existing holding by securityId
 * 4. If not found, create a new holding via Monarch API
 * 5. Save mapping and return holdingId
 *
 * @param integrationId - Integration identifier (e.g., 'wealthsimple', 'questrade')
 * @param accountId - Source account ID
 * @param monarchAccountId - Monarch account ID
 * @param monarchSecurityId - Resolved Monarch security ID
 * @param position - Raw position object from the institution
 * @param holdings - Current Monarch holdings data
 * @param hooks - Integration-specific hooks
 * @returns Holding ID (existing or newly created)
 */
export async function resolveOrCreateHolding(
  integrationId: string,
  accountId: string,
  monarchAccountId: string,
  monarchSecurityId: string,
  position: Record<string, unknown>,
  holdings: MonarchHoldingsData | null,
  hooks: HoldingsSyncHooks,
): Promise<string> {
  const positionKey = hooks.getPositionKey(position);
  const symbol = hooks.getDisplaySymbol(position) || 'Unknown';

  // Step 1: Check stored mapping
  const existingMapping = accountService.getHoldingMapping(
    integrationId, accountId, positionKey as string,
  ) as HoldingMapping | null;

  if (existingMapping?.holdingId) {
    // Step 2: Validate stored holdingId against current Monarch holdings
    const validatedHolding = findHoldingById(existingMapping.holdingId, holdings);
    if (validatedHolding) {
      debugLog(`[holdingsSync] Found stored holding ID for ${symbol}: ${existingMapping.holdingId} (validated in Monarch)`);
      return existingMapping.holdingId;
    }

    // Stored holdingId is stale — holding no longer exists in Monarch
    debugLog(`[holdingsSync] Stored holding ID ${existingMapping.holdingId} for ${symbol} is stale (not found in Monarch), will re-create`);
    accountService.saveHoldingMapping(integrationId, accountId, positionKey as string, {
      securityId: existingMapping.securityId,
      holdingId: null,
      symbol: existingMapping.symbol,
    });
  }

  // Step 3: Search for existing holding by securityId
  const existingHolding = findExistingHolding(monarchSecurityId, holdings);

  if (existingHolding) {
    debugLog(`[holdingsSync] Found existing holding in Monarch for ${symbol}: ${existingHolding.id}`);
    accountService.saveHoldingMapping(integrationId, accountId, positionKey as string, {
      securityId: monarchSecurityId,
      holdingId: existingHolding.id,
      symbol,
    });
    return existingHolding.id;
  }

  // Step 4: Create new holding
  const quantity = hooks.getQuantity(position);
  debugLog(`[holdingsSync] Creating new holding for ${symbol} in Monarch account ${monarchAccountId}, quantity: ${quantity}`);

  const newHolding = (await monarchApi.createManualHolding(monarchAccountId, monarchSecurityId, quantity)) as { id: string };

  // Step 5: Save mapping
  accountService.saveHoldingMapping(integrationId, accountId, positionKey as string, {
    securityId: monarchSecurityId,
    holdingId: newHolding.id,
    symbol,
  });

  debugLog(`[holdingsSync] Created and saved holding: ${symbol} -> ${newHolding.id}`);
  return newHolding.id;
}

/**
 * Sync position data to a Monarch holding (update quantity, costBasis, type).
 *
 * @param holdingId - Monarch holding ID to update
 * @param position - Raw position object from the institution
 * @param hooks - Integration-specific hooks
 */
export async function syncPositionToHolding(
  holdingId: string,
  position: Record<string, unknown>,
  hooks: HoldingsSyncHooks,
): Promise<void> {
  const symbol = hooks.getDisplaySymbol(position) || 'Unknown';
  debugLog(`[holdingsSync] Syncing position ${symbol} to holding ${holdingId}`);

  const updates = hooks.buildHoldingUpdate(position);
  await monarchApi.updateHolding(holdingId, updates);

  debugLog(`[holdingsSync] Successfully synced ${symbol}: ${JSON.stringify(updates)}`);
}

/**
 * Detect and remove deleted holdings.
 *
 * Positions at the institution are the source of truth. Holdings in Monarch
 * must always match positions in the source. Mappings are preserved for
 * future re-purchases.
 *
 * Logic for each Monarch holding:
 * 1. Has mapping AND mapped position still exists → keep
 * 2. Has mapping AND mapped position no longer exists → delete holding, clear holdingId
 * 3. No mapping AND ticker matches a position → auto-repair (create mapping)
 * 4. No mapping AND no matching position → delete holding
 *
 * @param integrationId - Integration identifier
 * @param accountId - Source account ID
 * @param monarchAccountId - Monarch account ID
 * @param currentPositions - Current positions from the institution
 * @param hooks - Integration-specific hooks
 * @returns Counts of deleted and auto-repaired holdings
 */
export async function detectAndRemoveDeletedHoldings(
  integrationId: string,
  accountId: string,
  monarchAccountId: string,
  currentPositions: Record<string, unknown>[],
  hooks: HoldingsSyncHooks,
): Promise<{ deleted: number; autoRepaired: number }> {
  let deletedCount = 0;
  let autoRepairedCount = 0;

  try {
    debugLog(`[holdingsSync] Detecting deleted holdings for ${integrationId}/${accountId}`);

    // Fetch current Monarch holdings
    const portfolio = (await monarchApi.getHoldings([monarchAccountId])) as MonarchHoldingsData | null;

    if (!portfolio?.aggregateHoldings?.edges) {
      debugLog('[holdingsSync] No holdings found in Monarch');
      return { deleted: 0, autoRepaired: 0 };
    }

    // Load stored mappings
    const mappings = (accountService.getHoldingsMappings(integrationId, accountId) || {}) as Record<string, HoldingMapping>;

    // Build set of current position keys (source of truth)
    const currentPositionKeys = new Set<string>();
    for (const position of currentPositions) {
      const key = hooks.getPositionKey(position);
      if (key) currentPositionKeys.add(key);
    }

    // Build position lookup by ticker (for auto-repair)
    const getTickerFn = hooks.getTickerForAutoRepair || hooks.getDisplaySymbol;
    const positionsByTicker = new Map<string, Record<string, unknown>>();
    for (const position of currentPositions) {
      const ticker = getTickerFn(position);
      if (ticker) positionsByTicker.set(ticker, position);
    }

    debugLog(`[holdingsSync] Found ${portfolio.aggregateHoldings.edges.length} aggregate holdings in Monarch, ${currentPositionKeys.size} source positions`);

    // Process each Monarch holding
    for (const edge of portfolio.aggregateHoldings.edges) {
      const aggregateHolding = edge.node;

      if (!aggregateHolding.holdings || !Array.isArray(aggregateHolding.holdings)) {
        continue;
      }

      for (const holding of aggregateHolding.holdings) {
        const holdingId = holding.id;
        const ticker = holding.ticker;

        if (!holdingId || !ticker) continue;

        // Find mapping entry for this holdingId
        const mappingEntry = Object.entries(mappings).find(([, m]) => m.holdingId === holdingId);

        if (mappingEntry) {
          const [mappingKey, mappingData] = mappingEntry;

          // Case 1: Mapped position still exists → keep
          if (currentPositionKeys.has(mappingKey)) {
            debugLog(`[holdingsSync] Holding ${ticker} (${holdingId}) has mapping and position exists, keeping`);
            continue;
          }

          // Case 2: Mapped position no longer exists → delete holding, clear holdingId
          try {
            debugLog(`[holdingsSync] Deleting holding for sold position: ${ticker} (${holdingId}) - position no longer exists`);
            await monarchApi.deleteHolding(holdingId);
            debugLog(`[holdingsSync] Successfully deleted holding ${ticker}`);
            deletedCount += 1;

            // Clear holdingId from mapping but preserve securityId for future re-purchases
            accountService.saveHoldingMapping(integrationId, accountId, mappingKey, {
              securityId: mappingData.securityId,
              holdingId: null,
              symbol: mappingData.symbol,
            });
            debugLog(`[holdingsSync] Cleared holdingId from mapping for ${ticker}, preserved securityId ${mappingData.securityId}`);
          } catch (error: unknown) {
            debugLog(`[holdingsSync] Failed to delete holding ${ticker} (${holdingId}):`, error);
          }
          continue;
        }

        // No mapping exists — check if ticker matches a source position
        const matchingPosition = positionsByTicker.get(ticker);

        if (matchingPosition) {
          // Case 3: Auto-repair — create missing mapping
          const getSourceIdFn = hooks.getAutoRepairSourceId || hooks.getPositionKey;
          const sourceId = getSourceIdFn(matchingPosition);
          const monarchSecurityId = aggregateHolding.security?.id;

          if (sourceId && monarchSecurityId) {
            debugLog(`[holdingsSync] Auto-repairing mapping for ${ticker}: sourceId=${sourceId}, holdingId=${holdingId}`);

            accountService.saveHoldingMapping(integrationId, accountId, sourceId, {
              securityId: monarchSecurityId,
              holdingId,
              symbol: ticker,
            });

            autoRepairedCount += 1;
          }
        } else {
          // Case 4: No mapping AND no matching position → delete orphaned holding
          try {
            debugLog(`[holdingsSync] Deleting orphaned holding: ${ticker} (${holdingId}) - no matching source position`);
            await monarchApi.deleteHolding(holdingId);
            debugLog(`[holdingsSync] Successfully deleted holding ${ticker}`);
            deletedCount += 1;
          } catch (error: unknown) {
            debugLog(`[holdingsSync] Failed to delete holding ${ticker} (${holdingId}):`, error);
          }
        }
      }
    }

    debugLog(`[holdingsSync] Deletion complete: ${deletedCount} deleted, ${autoRepairedCount} auto-repaired`);
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  } catch (error: unknown) {
    debugLog('[holdingsSync] Error detecting deleted holdings:', error);
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  }
}

/**
 * Process positions for a single account — top-level orchestration.
 *
 * Drives the full holdings sync workflow:
 * 1. Fetch Monarch holdings for the account
 * 2. For each position: resolve security → resolve/create holding → sync data
 * 3. Detect and remove deleted holdings
 * 4. Report results
 *
 * @param integrationId - Integration identifier
 * @param accountId - Source account ID
 * @param monarchAccountId - Monarch account ID
 * @param positions - Array of raw position objects from the institution
 * @param hooks - Integration-specific hooks
 * @param progress - Optional progress callback
 * @returns Holdings sync result with counts
 */
export async function processAccountPositions(
  integrationId: string,
  accountId: string,
  monarchAccountId: string,
  positions: Record<string, unknown>[],
  hooks: HoldingsSyncHooks,
  progress: HoldingsSyncProgress | null = null,
): Promise<HoldingsSyncResult> {
  const result: HoldingsSyncResult = {
    success: false,
    positionsProcessed: 0,
    positionsSkipped: 0,
    holdingsRemoved: 0,
    mappingsAutoRepaired: 0,
    error: null,
  };

  try {
    if (!positions || positions.length === 0) {
      debugLog(`[holdingsSync] No positions to process for ${integrationId}/${accountId}`);
      if (progress) progress.updateStatus('success', 'No positions');
      result.success = true;
      return result;
    }

    debugLog(`[holdingsSync] Processing ${positions.length} positions for ${integrationId}/${accountId}`);

    // Fetch current Monarch holdings (once for the whole batch)
    if (progress) progress.updateStatus('processing', 'Fetching Monarch holdings...');
    const holdings = (await monarchApi.getHoldings([monarchAccountId])) as MonarchHoldingsData | null;

    // Process each position
    for (let i = 0; i < positions.length; i += 1) {
      const position = positions[i];
      const symbol = hooks.getDisplaySymbol(position) || 'Unknown';

      try {
        if (progress) {
          progress.updateStatus('processing', `Processing ${i + 1}/${positions.length}: ${symbol}...`);
        }

        // Resolve security mapping (integration-specific: crypto auto-map, user prompt, etc.)
        const monarchSecurityId = await hooks.resolveSecurityMapping(accountId, position);

        if (!monarchSecurityId) {
          debugLog(`[holdingsSync] Skipping position ${symbol} (user cancelled or unmappable)`);
          result.positionsSkipped += 1;
          continue;
        }

        // Resolve or create holding (generic algorithm)
        const holdingId = await resolveOrCreateHolding(
          integrationId, accountId, monarchAccountId, monarchSecurityId,
          position, holdings, hooks,
        );

        // Sync position data to holding (generic, with integration-specific payload)
        await syncPositionToHolding(holdingId, position, hooks);

        result.positionsProcessed += 1;
        debugLog(`[holdingsSync] Successfully processed position ${symbol}`);
      } catch (error: unknown) {
        debugLog(`[holdingsSync] Error processing position ${symbol}:`, error);
        result.positionsSkipped += 1;
      }
    }

    // Detect and remove deleted holdings
    if (progress) progress.updateStatus('processing', 'Checking for deleted positions...');

    const deletionResult = await detectAndRemoveDeletedHoldings(
      integrationId, accountId, monarchAccountId, positions, hooks,
    );
    result.holdingsRemoved = deletionResult.deleted;
    result.mappingsAutoRepaired = deletionResult.autoRepaired;
    result.success = true;

    // Build status message
    let statusMsg = `${result.positionsProcessed} synced`;
    if (result.mappingsAutoRepaired > 0) statusMsg += `, ${result.mappingsAutoRepaired} repaired`;
    if (result.holdingsRemoved > 0) statusMsg += `, ${result.holdingsRemoved} deleted`;

    if (progress) progress.updateStatus('success', statusMsg);

    debugLog(`[holdingsSync] Completed for ${integrationId}/${accountId}: ${result.positionsProcessed} processed, ${result.positionsSkipped} skipped, ${result.mappingsAutoRepaired} repaired, ${result.holdingsRemoved} deleted`);
  } catch (error: unknown) {
    debugLog(`[holdingsSync] Error processing positions for ${integrationId}/${accountId}:`, error);
    result.error = (error as Error).message;
    if (progress) progress.updateStatus('error', `Error: ${(error as Error).message}`);
  }

  return result;
}

export default {
  findHoldingById,
  findExistingHolding,
  resolveOrCreateHolding,
  syncPositionToHolding,
  detectAndRemoveDeletedHoldings,
  processAccountPositions,
};