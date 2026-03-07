/**
 * Positions Service
 * Handles fetching, mapping, and synchronizing Questrade positions to Monarch holdings
 */

import { debugLog } from '../../core/utils';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import questradeApi from '../../api/questrade';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import { showMonarchSecuritySelector } from '../../ui/components/securitySelector';
import toast from '../../ui/toast';

/**
 * Custom positions error class
 */
export class PositionsError extends Error {
  accountId: string | null;
  position: unknown;

  constructor(message, accountId, position = null) {
    super(message);
    this.name = 'PositionsError';
    this.accountId = accountId;
    this.position = position;
  }
}

/**
 * Fetch positions for a Questrade account
 * @param {string} accountId - Account UUID
 * @returns {Promise<Array>} Array of position objects
 */
export async function fetchPositions(accountId) {
  try {
    debugLog(`Fetching positions for account ${accountId}`);

    if (!accountId) {
      throw new PositionsError('Account ID is required', accountId);
    }

    const response = await questradeApi.fetchPositions(accountId);

    // Extract positions array from response
    const positions = response?.data || [];

    debugLog(`Fetched ${positions.length} positions for account ${accountId}`);
    return Array.isArray(positions) ? positions : [];
  } catch (error) {
    debugLog(`Error fetching positions for account ${accountId}:`, error);
    throw new PositionsError(`Failed to fetch positions: ${error.message}`, accountId);
  }
}

/**
 * Resolve security mapping for a position
 * @param {string} accountId - Questrade account ID
 * @param {Object} position - Position object with security details
 * @returns {Promise<string|null>} Monarch security ID, or null if cancelled
 */
export async function resolveSecurityMapping(accountId, position) {
  try {
    const securityUuid = position.securityUuid || position.symbolId;
    if (!securityUuid) {
      throw new PositionsError('Position missing security UUID', accountId, position);
    }

    // Check for existing mapping using accountService (unified structure)
    const existingMapping = accountService.getHoldingMapping(INTEGRATIONS.QUESTRADE, accountId, securityUuid);
    if (existingMapping?.securityId) {
      debugLog(`Found existing security mapping for ${position.security?.symbol}: ${existingMapping.securityId}`);
      return existingMapping.securityId;
    }

    debugLog(`No mapping found for ${position.security?.symbol}, showing security selector`);

    // Show security selector to user
    const selectedSecurity = await new Promise((resolve) => {
      showMonarchSecuritySelector(position, resolve);
    });

    if (!selectedSecurity) {
      // User cancelled
      debugLog(`User cancelled security selection for ${position.security?.symbol}`);
      return null;
    }

    const sel = selectedSecurity as Record<string, unknown>;
    debugLog(`Selected security: ${position.security?.symbol} (${securityUuid}) -> ${sel.name} (${sel.id})`);

    return sel.id;
  } catch (error) {
    debugLog('Error resolving security mapping for position:', error);
    throw new PositionsError(`Failed to resolve security mapping: ${error.message}`, accountId, position);
  }
}

/**
 * Find existing holding for a security in Monarch account
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} securityId - Security ID to find
 * @param {Array} holdings - Array of holdings from Monarch
 * @returns {Object|null} Holding object if found, null otherwise
 */
function findExistingHolding(monarchAccountId, securityId, holdings) {
  if (!holdings || !holdings.aggregateHoldings || !holdings.aggregateHoldings.edges) {
    return null;
  }

  // Search through aggregate holdings
  for (const edge of holdings.aggregateHoldings.edges) {
    const aggregateHolding = edge.node;

    // Check if this aggregate holding's security matches
    if (aggregateHolding.security && aggregateHolding.security.id === securityId) {
      // Find the specific holding for our account
      if (aggregateHolding.holdings && Array.isArray(aggregateHolding.holdings)) {
        // Note: holdings array contains individual holdings, we need to check if any belong to our account
        // Since we don't have account ID in the holding object, we'll use the first manual holding
        const manualHolding = aggregateHolding.holdings.find((h) => h.isManual);
        if (manualHolding) {
          return manualHolding;
        }
      }
    }
  }

  return null;
}

/**
 * Resolve or create holding for a position
 * @param {string} accountId - Questrade account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} securityId - Monarch security ID
 * @param {Object} position - Position object
 * @param {Object} holdings - Holdings data from Monarch
 * @returns {Promise<string>} Holding ID
 */
export async function resolveOrCreateHolding(accountId, monarchAccountId, securityId, position, holdings) {
  try {
    const securityUuid = position.securityUuid || position.symbolId;
    const symbol = position.security?.symbol || 'Unknown';

    // Check for existing holding ID using accountService (unified structure)
    const existingMapping = accountService.getHoldingMapping(INTEGRATIONS.QUESTRADE, accountId, securityUuid);
    if (existingMapping?.holdingId) {
      debugLog(`Found stored holding ID for ${symbol}: ${existingMapping.holdingId}`);
      return existingMapping.holdingId;
    }

    // Check if holding exists in Monarch
    const existingHolding = findExistingHolding(monarchAccountId, securityId, holdings);

    if (existingHolding) {
      debugLog(`Found existing holding in Monarch for ${symbol}: ${existingHolding.id}`);
      // Save the mapping using unified structure via accountService
      accountService.saveHoldingMapping(INTEGRATIONS.QUESTRADE, accountId, securityUuid, {
        securityId,
        holdingId: existingHolding.id,
        symbol,
      });
      return existingHolding.id;
    }

    // Create new holding
    debugLog(`Creating new holding for ${symbol} in Monarch account ${monarchAccountId}`);
    const newHolding = await monarchApi.createManualHolding(
      monarchAccountId,
      securityId,
      position.openQuantity || 0,
    );

    // Save the mapping using unified structure via accountService
    accountService.saveHoldingMapping(INTEGRATIONS.QUESTRADE, accountId, securityUuid, {
      securityId,
      holdingId: newHolding.id,
      symbol,
    });
    debugLog(`Created and saved holding: ${symbol} -> ${newHolding.id}`);

    return newHolding.id;
  } catch (error) {
    debugLog('Error resolving/creating holding for position:', error);
    throw new PositionsError(`Failed to resolve or create holding: ${error.message}`, accountId, position);
  }
}

/**
 * Sync position data to Monarch holding
 * @param {string} holdingId - Holding ID to update
 * @param {Object} position - Position object with current data
 * @returns {Promise<void>}
 */
export async function syncPositionToHolding(holdingId, position) {
  try {
    debugLog(`Syncing position ${position.security?.symbol} to holding ${holdingId}`);

    // Prepare update data
    const updates = {
      quantity: position.openQuantity || 0,
      costBasis: position.averageEntryPrice || position.averagePrice || 0,
    };

    // Map security type if available
    if (position.securityType) {
      // Questrade security types: Stock, Option, Bond, MutualFund, Index
      // Monarch expects: equity, option, bond, mutualFund, index, etc.
      const typeMap = {
        Stock: 'equity',
        Option: 'option',
        Bond: 'bond',
        MutualFund: 'mutualFund',
        Index: 'index',
      };
      (updates as Record<string, unknown>).securityType = typeMap[position.securityType] || 'equity';
    }

    await monarchApi.updateHolding(holdingId, updates);
    debugLog(`Successfully synced ${position.security?.symbol}: quantity=${updates.quantity}, costBasis=${updates.costBasis}`);
  } catch (error) {
    debugLog('Error syncing position to holding:', error);
    throw new PositionsError(`Failed to sync position: ${error.message}`, null, position);
  }
}

/**
 * Detect and remove deleted holdings
 * Positions at the institution are the source of truth. Holdings in Monarch must
 * always match positions in Questrade. Mappings are preserved for future re-purchases.
 *
 * Logic for each Monarch holding:
 * 1. Has mapping AND mapped position still exists � keep
 * 2. Has mapping AND mapped position no longer exists � delete holding, clear holdingId from mapping
 * 3. No mapping AND ticker matches a position � auto-repair (create mapping)
 * 4. No mapping AND no matching position � delete holding
 *
 * @param {string} accountId - Questrade account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {Array} currentPositions - Current positions from Questrade
 * @returns {Promise<Object>} Object with deleted and autoRepaired counts
 */
export async function detectAndRemoveDeletedHoldings(accountId, monarchAccountId, currentPositions) {
  let deletedCount = 0;
  let autoRepairedCount = 0;

  try {
    debugLog(`Detecting deleted holdings for account ${accountId}`);

    // Step 1: Fetch current Monarch holdings
    const portfolio = await monarchApi.getHoldings([monarchAccountId]);

    if (!portfolio || !portfolio.aggregateHoldings || !portfolio.aggregateHoldings.edges) {
      debugLog('No holdings found in Monarch');
      return { deleted: 0, autoRepaired: 0 };
    }

    // Step 2: Load stored mappings using accountService
    const mappings = accountService.getHoldingsMappings(INTEGRATIONS.QUESTRADE, accountId);

    // Step 3: Build set of current position security keys (source of truth)
    const currentPositionKeys = new Set();
    for (const position of currentPositions) {
      const key = position.securityUuid || position.symbolId;
      if (key) {
        currentPositionKeys.add(key);
      }
    }

    // Build Questrade position lookup by symbol (for auto-repair)
    const positionsBySymbol = new Map();
    for (const position of currentPositions) {
      const symbol = position.security?.symbol;
      if (symbol) {
        positionsBySymbol.set(symbol, position);
      }
    }

    debugLog(`Found ${portfolio.aggregateHoldings.edges.length} aggregate holdings in Monarch, ${currentPositionKeys.size} Questrade positions`);

    // Step 4: Process each Monarch holding
    for (const edge of portfolio.aggregateHoldings.edges) {
      const aggregateHolding = edge.node;

      if (!aggregateHolding.holdings || !Array.isArray(aggregateHolding.holdings)) {
        continue;
      }

      // Process individual holdings within this aggregate holding
      for (const holding of aggregateHolding.holdings) {
        const holdingId = holding.id;
        const ticker = holding.ticker;

        if (!holdingId || !ticker) {
          continue;
        }

        // Find mapping entry for this holding ID
        const mappingEntry = Object.entries(mappings).find(([, m]) => m.holdingId === holdingId);

        if (mappingEntry) {
          const [mappingKey, mappingData] = mappingEntry;

          // Check if the mapped position still exists in current positions
          if (currentPositionKeys.has(mappingKey)) {
            // Case 1: Mapped position still exists � keep
            debugLog(`Holding ${ticker} (${holdingId}) has mapping and position exists, keeping`);
            continue;
          }

          // Case 2: Mapped position no longer exists � delete holding, clear holdingId
          try {
            debugLog(`Deleting holding for sold position: ${ticker} (${holdingId}) - position no longer exists`);
            await monarchApi.deleteHolding(holdingId);
            debugLog(`Successfully deleted holding ${ticker}`);
            deletedCount += 1;

            // Clear holdingId from mapping but preserve securityId for future re-purchases
            accountService.saveHoldingMapping(INTEGRATIONS.QUESTRADE, accountId, mappingKey, {
              securityId: mappingData.securityId,
              holdingId: null,
              symbol: mappingData.symbol,
            });
            debugLog(`Cleared holdingId from mapping for ${ticker}, preserved securityId ${mappingData.securityId}`);
          } catch (error) {
            debugLog(`Failed to delete holding ${ticker} (${holdingId}):`, error);
          }
          continue;
        }

        // No mapping exists - check if ticker matches a Questrade position
        const matchingPosition = positionsBySymbol.get(ticker);

        if (matchingPosition) {
          // Case 3: Auto-repair - create missing mapping
          const securityUuid = matchingPosition.securityUuid || matchingPosition.symbolId;
          const securityId = aggregateHolding.security?.id;

          if (securityUuid && securityId) {
            debugLog(`Auto-repairing mapping for ${ticker}: securityUuid=${securityUuid}, holdingId=${holdingId}`);

            accountService.saveHoldingMapping(INTEGRATIONS.QUESTRADE, accountId, securityUuid, {
              securityId,
              holdingId,
              symbol: ticker,
            });

            autoRepairedCount += 1;
          }
        } else {
          // Case 4: No mapping AND no matching position � delete orphaned holding
          try {
            debugLog(`Deleting orphaned holding: ${ticker} (${holdingId}) - no matching Questrade position`);
            await monarchApi.deleteHolding(holdingId);
            debugLog(`Successfully deleted holding ${ticker}`);
            deletedCount += 1;
          } catch (error) {
            // Log error but continue with other deletions
            debugLog(`Failed to delete holding ${ticker} (${holdingId}):`, error);
          }
        }
      }
    }

    debugLog(`Deletion complete: ${deletedCount} deleted, ${autoRepairedCount} auto-repaired`);
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  } catch (error) {
    debugLog('Error detecting deleted holdings:', error);
    // Non-fatal error, return counts of successful operations
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  }
}

/**
 * Process positions for a single account
 * @param {string} accountId - Questrade account ID
 * @param {string} accountName - Account name for display
 * @param {string} monarchAccountId - Mapped Monarch account ID
 * @param {Object} progressDialog - Optional progress dialog for updates
 * @returns {Promise<Object>} Result with success status and counts
 */
export async function processAccountPositions(accountId, accountName, monarchAccountId, progressDialog = null) {
  const result = {
    success: false,
    positionsProcessed: 0,
    positionsSkipped: 0,
    holdingsRemoved: 0,
    mappingsAutoRepaired: 0,
    error: null,
  };

  try {
    debugLog(`Processing positions for account ${accountName} (${accountId})`);

    // Show start toast
    toast.show(`Starting positions sync for ${accountName}...`, 'info');

    // Update progress
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Fetching positions...');
    }

    // Step 1: Fetch positions from Questrade
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

    // Step 2: Fetch current holdings from Monarch
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Fetching Monarch holdings...');
    }

    const holdings = await monarchApi.getHoldings([monarchAccountId]);

    // Step 3: Process each position
    for (let i = 0; i < positions.length; i += 1) {
      const position = positions[i];
      const symbol = position.security?.symbol || 'Unknown';

      try {
        if (progressDialog) {
          progressDialog.updateProgress(
            accountId,
            'processing',
            `Processing position ${i + 1}/${positions.length}: ${symbol}...`,
          );
        }

        // Resolve security mapping
        const securityId = await resolveSecurityMapping(accountId, position);

        if (!securityId) {
          // User cancelled mapping for this position
          debugLog(`Skipping position ${symbol} (user cancelled)`);
          result.positionsSkipped += 1;
          continue;
        }

        // Resolve or create holding
        const holdingId = await resolveOrCreateHolding(
          accountId,
          monarchAccountId,
          securityId,
          position,
          holdings,
        );

        // Sync position data
        await syncPositionToHolding(holdingId, position);

        result.positionsProcessed += 1;
        debugLog(`Successfully processed position ${symbol}`);
      } catch (error) {
        debugLog(`Error processing position ${symbol}:`, error);
        // Continue with next position
        result.positionsSkipped += 1;
      }
    }

    // Step 4: Detect and remove deleted holdings
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'processing', 'Checking for deleted positions...');
    }

    const deletionResult = await detectAndRemoveDeletedHoldings(accountId, monarchAccountId, positions);
    result.holdingsRemoved = deletionResult.deleted;
    result.mappingsAutoRepaired = deletionResult.autoRepaired;

    // Success!
    result.success = true;

    // Build status message
    let statusMsg = `Synced ${result.positionsProcessed} positions`;
    if (result.mappingsAutoRepaired > 0) {
      statusMsg += `, repaired ${result.mappingsAutoRepaired} mappings`;
    }
    if (result.holdingsRemoved > 0) {
      statusMsg += `, removed ${result.holdingsRemoved} deleted`;
    }

    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'success', statusMsg);
    }

    // Show completion summary toast
    const toastParts = [`Synced ${result.positionsProcessed} positions for ${accountName}`];
    if (result.positionsSkipped > 0) {
      toastParts.push(`${result.positionsSkipped} skipped`);
    }
    if (result.mappingsAutoRepaired > 0) {
      toastParts.push(`${result.mappingsAutoRepaired} repaired`);
    }
    if (result.holdingsRemoved > 0) {
      toastParts.push(`${result.holdingsRemoved} deleted`);
    }

    const toastMsg = toastParts.length > 1
      ? `${toastParts[0]} (${toastParts.slice(1).join(', ')})`
      : toastParts[0];

    toast.show(toastMsg, 'info');

    debugLog(`Completed processing positions for ${accountName}: ${result.positionsProcessed} processed, ${result.positionsSkipped} skipped, ${result.mappingsAutoRepaired} repaired, ${result.holdingsRemoved} deleted`);
  } catch (error) {
    debugLog(`Error processing account positions for ${accountId}:`, error);
    result.error = error.message;
    if (progressDialog) {
      progressDialog.updateProgress(accountId, 'error', `Error: ${error.message}`);
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
};
