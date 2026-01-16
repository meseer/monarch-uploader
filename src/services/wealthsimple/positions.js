/**
 * Wealthsimple Positions Service
 * Handles fetching, mapping, and synchronizing Wealthsimple positions to Monarch holdings
 */

import { debugLog } from '../../core/utils';
import wealthsimpleApi from '../../api/wealthsimple';
import monarchApi from '../../api/monarch';
import { showMonarchSecuritySelector } from '../../ui/components/securitySelector';
import toast from '../../ui/toast';
import { getAccountData, updateAccountInList } from './account';

/**
 * Custom positions error class
 */
export class PositionsError extends Error {
  constructor(message, accountId, position = null) {
    super(message);
    this.name = 'PositionsError';
    this.accountId = accountId;
    this.position = position;
  }
}

/**
 * Investment account types that support position sync
 */
const INVESTMENT_ACCOUNT_TYPES = new Set([
  'MANAGED_RESP_FAMILY',
  'MANAGED_RESP',
  'MANAGED_NON_REGISTERED',
  'MANAGED_TFSA',
  'MANAGED_RRSP',
  'SELF_DIRECTED_RESP_FAMILY',
  'SELF_DIRECTED_RESP',
  'SELF_DIRECTED_NON_REGISTERED',
  'SELF_DIRECTED_TFSA',
  'SELF_DIRECTED_RRSP',
  'SELF_DIRECTED_CRYPTO',
]);

/**
 * Check if an account type is an investment account
 * @param {string} accountType - Wealthsimple account type
 * @returns {boolean} True if investment account
 */
export function isInvestmentAccount(accountType) {
  return INVESTMENT_ACCOUNT_TYPES.has(accountType);
}

/**
 * Load holdings mappings for an account from consolidated account structure
 * @param {string} accountId - Wealthsimple account ID
 * @returns {Object} Mappings object { securityId: { monarchSecurityId, monarchHoldingId, symbol } }
 */
function loadHoldingsMappings(accountId) {
  const accountData = getAccountData(accountId);
  return accountData?.holdingsMappings || {};
}

/**
 * Save a holding mapping to the consolidated account structure
 * @param {string} accountId - Wealthsimple account ID
 * @param {string} wsSecurityId - Wealthsimple security ID
 * @param {Object} data - Mapping data { monarchSecurityId, monarchHoldingId, symbol }
 */
function saveHoldingMapping(accountId, wsSecurityId, data) {
  const mappings = loadHoldingsMappings(accountId);
  mappings[wsSecurityId] = data;
  updateAccountInList(accountId, { holdingsMappings: mappings });
  debugLog(`Saved holding mapping for ${data.symbol}: ${wsSecurityId} -> ${data.monarchHoldingId}`);
}

/**
 * Get the symbol to use for security lookup in Monarch
 * For options: use osiSymbol with whitespace removed
 * For stocks/ETFs: use stock symbol
 * @param {Object} position - Position object with security details
 * @returns {string} Symbol to use for lookup
 */
export function getSecuritySymbolForLookup(position) {
  const security = position.security;
  if (!security) {
    return null;
  }

  // Check if this is an option
  if (security.securityType === 'OPTION' && security.optionDetails?.osiSymbol) {
    // Remove all whitespace from OSI symbol
    return security.optionDetails.osiSymbol.replace(/\s/g, '');
  }

  // For stocks and ETFs, use the stock symbol
  if (security.stock?.symbol) {
    return security.stock.symbol;
  }

  return null;
}

/**
 * Get security name for display
 * @param {Object} position - Position object with security details
 * @returns {string} Security name
 */
function getSecurityName(position) {
  const security = position.security;
  if (!security) {
    return 'Unknown';
  }

  if (security.stock?.name) {
    return security.stock.name;
  }

  // For options, use OSI symbol
  if (security.optionDetails?.osiSymbol) {
    return security.optionDetails.osiSymbol;
  }

  return security.id || 'Unknown';
}

/**
 * Fetch positions for a Wealthsimple account
 * @param {string} accountId - Account ID
 * @returns {Promise<Array>} Array of position objects
 */
export async function fetchPositions(accountId) {
  try {
    debugLog(`Fetching positions for account ${accountId}`);

    if (!accountId) {
      throw new PositionsError('Account ID is required', accountId);
    }

    const positions = await wealthsimpleApi.fetchIdentityPositions(accountId);

    debugLog(`Fetched ${positions.length} positions for account ${accountId}`);
    return Array.isArray(positions) ? positions : [];
  } catch (error) {
    debugLog(`Error fetching positions for account ${accountId}:`, error);
    throw new PositionsError(`Failed to fetch positions: ${error.message}`, accountId);
  }
}

/**
 * Resolve security mapping for a position
 * @param {string} accountId - Wealthsimple account ID
 * @param {Object} position - Position object with security details
 * @returns {Promise<string|null>} Monarch security ID, or null if cancelled
 */
export async function resolveSecurityMapping(accountId, position) {
  try {
    const wsSecurityId = position.security?.id;
    if (!wsSecurityId) {
      throw new PositionsError('Position missing security ID', accountId, position);
    }

    const symbol = getSecuritySymbolForLookup(position);

    // Check for existing mapping in consolidated account structure
    const mappings = loadHoldingsMappings(accountId);
    if (mappings[wsSecurityId]?.monarchSecurityId) {
      debugLog(`Found existing security mapping for ${symbol}: ${mappings[wsSecurityId].monarchSecurityId}`);
      return mappings[wsSecurityId].monarchSecurityId;
    }

    debugLog(`No mapping found for ${symbol}, showing security selector`);

    // Build position info for the selector
    const positionInfo = {
      security: {
        symbol,
        name: getSecurityName(position),
        securityType: position.security?.securityType,
      },
      openQuantity: Math.abs(parseFloat(position.quantity) || 0),
      currentMarketValue: parseFloat(position.totalValue?.amount) || 0,
      currentPrice: parseFloat(position.security?.quoteV2?.price) || 0,
    };

    // Show security selector to user
    const selectedSecurity = await new Promise((resolve) => {
      showMonarchSecuritySelector(positionInfo, resolve);
    });

    if (!selectedSecurity) {
      debugLog(`User cancelled security selection for ${symbol}`);
      return null;
    }

    debugLog(`Selected security: ${symbol} (${wsSecurityId}) -> ${selectedSecurity.name} (${selectedSecurity.id})`);

    return selectedSecurity.id;
  } catch (error) {
    debugLog('Error resolving security mapping for position:', error);
    throw new PositionsError(`Failed to resolve security mapping: ${error.message}`, accountId, position);
  }
}

/**
 * Find existing holding for a security in Monarch account
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} securityId - Security ID to find
 * @param {Object} holdings - Holdings data from Monarch
 * @returns {Object|null} Holding object if found, null otherwise
 */
function findExistingHolding(monarchAccountId, securityId, holdings) {
  if (!holdings || !holdings.aggregateHoldings || !holdings.aggregateHoldings.edges) {
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

/**
 * Resolve or create holding for a position
 * @param {string} accountId - Wealthsimple account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {string} monarchSecurityId - Monarch security ID
 * @param {Object} position - Position object
 * @param {Object} holdings - Holdings data from Monarch
 * @returns {Promise<string>} Holding ID
 */
export async function resolveOrCreateHolding(accountId, monarchAccountId, monarchSecurityId, position, holdings) {
  try {
    const wsSecurityId = position.security?.id;
    const symbol = getSecuritySymbolForLookup(position);

    // Check for existing holding ID in consolidated account structure
    const mappings = loadHoldingsMappings(accountId);
    if (mappings[wsSecurityId]?.monarchHoldingId) {
      debugLog(`Found stored holding ID for ${symbol}: ${mappings[wsSecurityId].monarchHoldingId}`);
      return mappings[wsSecurityId].monarchHoldingId;
    }

    // Check if holding exists in Monarch
    const existingHolding = findExistingHolding(monarchAccountId, monarchSecurityId, holdings);

    if (existingHolding) {
      debugLog(`Found existing holding in Monarch for ${symbol}: ${existingHolding.id}`);
      // Save the mapping
      saveHoldingMapping(accountId, wsSecurityId, {
        monarchSecurityId,
        monarchHoldingId: existingHolding.id,
        symbol,
      });
      return existingHolding.id;
    }

    // Create new holding
    const quantity = Math.abs(parseFloat(position.quantity) || 0);
    debugLog(`Creating new holding for ${symbol} in Monarch account ${monarchAccountId}, quantity: ${quantity}`);

    const newHolding = await monarchApi.createManualHolding(
      monarchAccountId,
      monarchSecurityId,
      quantity,
    );

    // Save the mapping
    saveHoldingMapping(accountId, wsSecurityId, {
      monarchSecurityId,
      monarchHoldingId: newHolding.id,
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
 * Uses abs(quantity) since Monarch doesn't support negative positions
 * @param {string} holdingId - Holding ID to update
 * @param {Object} position - Position object with current data
 * @returns {Promise<void>}
 */
export async function syncPositionToHolding(holdingId, position) {
  try {
    const symbol = getSecuritySymbolForLookup(position);
    debugLog(`Syncing position ${symbol} to holding ${holdingId}`);

    // Use abs() for quantity - Monarch doesn't support negative positions
    const quantity = Math.abs(parseFloat(position.quantity) || 0);

    // Get cost basis from averagePrice
    const costBasis = parseFloat(position.averagePrice?.amount) || 0;

    const updates = {
      quantity,
      costBasis,
    };

    // Map security type if available
    const securityType = position.security?.securityType;
    if (securityType) {
      const typeMap = {
        EQUITY: 'equity',
        OPTION: 'option',
        BOND: 'bond',
        EXCHANGE_TRADED_FUND: 'etf',
        MUTUAL_FUND: 'mutualFund',
      };
      updates.securityType = typeMap[securityType] || 'equity';
    }

    await monarchApi.updateHolding(holdingId, updates);
    debugLog(`Successfully synced ${symbol}: quantity=${quantity}, costBasis=${costBasis}`);
  } catch (error) {
    debugLog('Error syncing position to holding:', error);
    throw new PositionsError(`Failed to sync position: ${error.message}`, null, position);
  }
}

/**
 * Detect and remove deleted holdings
 * Starts from Monarch holdings and validates against Wealthsimple positions.
 * Auto-repairs missing mappings when ticker matches, deletes orphaned holdings.
 * @param {string} accountId - Wealthsimple account ID
 * @param {string} monarchAccountId - Monarch account ID
 * @param {Array} currentPositions - Current positions from Wealthsimple
 * @returns {Promise<Object>} Object with deleted and autoRepaired counts
 */
export async function detectAndRemoveDeletedHoldings(accountId, monarchAccountId, currentPositions) {
  let deletedCount = 0;
  let autoRepairedCount = 0;

  try {
    debugLog(`Detecting deleted holdings for account ${accountId}`);

    // Fetch current Monarch holdings
    const portfolio = await monarchApi.getHoldings([monarchAccountId]);

    if (!portfolio || !portfolio.aggregateHoldings || !portfolio.aggregateHoldings.edges) {
      debugLog('No holdings found in Monarch');
      return { deleted: 0, autoRepaired: 0 };
    }

    // Load stored mappings
    const mappings = loadHoldingsMappings(accountId);

    // Build Wealthsimple position lookup by symbol
    const positionsBySymbol = new Map();
    for (const position of currentPositions) {
      const symbol = getSecuritySymbolForLookup(position);
      if (symbol) {
        positionsBySymbol.set(symbol, position);
      }
    }

    debugLog(`Found ${portfolio.aggregateHoldings.edges.length} aggregate holdings in Monarch, ${positionsBySymbol.size} Wealthsimple positions`);

    // Process each Monarch holding
    for (const edge of portfolio.aggregateHoldings.edges) {
      const aggregateHolding = edge.node;

      if (!aggregateHolding.holdings || !Array.isArray(aggregateHolding.holdings)) {
        continue;
      }

      for (const holding of aggregateHolding.holdings) {
        const holdingId = holding.id;
        const ticker = holding.ticker;

        if (!holdingId || !ticker) {
          continue;
        }

        // Check if we have a mapping for this holding ID
        const hasMapping = Object.values(mappings).some((m) => m.monarchHoldingId === holdingId);

        if (hasMapping) {
          debugLog(`Holding ${ticker} (${holdingId}) has mapping, keeping`);
          continue;
        }

        // No mapping exists - check if ticker matches a Wealthsimple position
        const matchingPosition = positionsBySymbol.get(ticker);

        if (matchingPosition) {
          // Auto-repair: Create missing mapping
          const wsSecurityId = matchingPosition.security?.id;
          const monarchSecurityId = aggregateHolding.security?.id;

          if (wsSecurityId && monarchSecurityId) {
            debugLog(`Auto-repairing mapping for ${ticker}: wsSecurityId=${wsSecurityId}, holdingId=${holdingId}`);

            saveHoldingMapping(accountId, wsSecurityId, {
              monarchSecurityId,
              monarchHoldingId: holdingId,
              symbol: ticker,
            });

            autoRepairedCount += 1;
          }
        } else {
          // No matching Wealthsimple position - delete orphaned holding
          try {
            debugLog(`Deleting orphaned holding: ${ticker} (${holdingId}) - no matching Wealthsimple position`);
            await monarchApi.deleteHolding(holdingId);
            debugLog(`Successfully deleted holding ${ticker}`);
            deletedCount += 1;
          } catch (error) {
            debugLog(`Failed to delete holding ${ticker} (${holdingId}):`, error);
          }
        }
      }
    }

    debugLog(`Deletion complete: ${deletedCount} deleted, ${autoRepairedCount} auto-repaired`);
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  } catch (error) {
    debugLog('Error detecting deleted holdings:', error);
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  }
}

/**
 * Process positions for a single account
 * @param {string} accountId - Wealthsimple account ID
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

    toast.show(`Starting positions sync for ${accountName}...`, 'debug');

    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'processing', 'Fetching positions...');
    }

    // Fetch positions from Wealthsimple
    const positions = await fetchPositions(accountId);

    if (!positions || positions.length === 0) {
      debugLog(`No positions found for account ${accountId}`);
      toast.show(`No positions found for ${accountName}`, 'info');
      if (progressDialog) {
        progressDialog.updateStepStatus(accountId, 'positions', 'success', 'No positions');
      }
      result.success = true;
      return result;
    }

    debugLog(`Found ${positions.length} positions to process`);

    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'processing', 'Fetching Monarch holdings...');
    }

    // Fetch current holdings from Monarch
    const holdings = await monarchApi.getHoldings([monarchAccountId]);

    // Process each position
    for (let i = 0; i < positions.length; i += 1) {
      const position = positions[i];
      const symbol = getSecuritySymbolForLookup(position) || 'Unknown';

      try {
        if (progressDialog) {
          progressDialog.updateStepStatus(
            accountId,
            'positions',
            'processing',
            `Processing ${i + 1}/${positions.length}: ${symbol}...`,
          );
        }

        // Resolve security mapping
        const monarchSecurityId = await resolveSecurityMapping(accountId, position);

        if (!monarchSecurityId) {
          debugLog(`Skipping position ${symbol} (user cancelled)`);
          result.positionsSkipped += 1;
          continue;
        }

        // Resolve or create holding
        const holdingId = await resolveOrCreateHolding(
          accountId,
          monarchAccountId,
          monarchSecurityId,
          position,
          holdings,
        );

        // Sync position data
        await syncPositionToHolding(holdingId, position);

        result.positionsProcessed += 1;
        debugLog(`Successfully processed position ${symbol}`);
      } catch (error) {
        debugLog(`Error processing position ${symbol}:`, error);
        result.positionsSkipped += 1;
      }
    }

    // Detect and remove deleted holdings
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'processing', 'Checking for deleted positions...');
    }

    const deletionResult = await detectAndRemoveDeletedHoldings(accountId, monarchAccountId, positions);
    result.holdingsRemoved = deletionResult.deleted;
    result.mappingsAutoRepaired = deletionResult.autoRepaired;

    result.success = true;

    // Build status message
    let statusMsg = `${result.positionsProcessed} synced`;
    if (result.mappingsAutoRepaired > 0) {
      statusMsg += `, ${result.mappingsAutoRepaired} repaired`;
    }
    if (result.holdingsRemoved > 0) {
      statusMsg += `, ${result.holdingsRemoved} deleted`;
    }

    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'success', statusMsg);
    }

    // Show completion toast
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
      progressDialog.updateStepStatus(accountId, 'positions', 'error', `Error: ${error.message}`);
    }
  }

  return result;
}

export default {
  isInvestmentAccount,
  fetchPositions,
  resolveSecurityMapping,
  resolveOrCreateHolding,
  syncPositionToHolding,
  detectAndRemoveDeletedHoldings,
  processAccountPositions,
  getSecuritySymbolForLookup,
  PositionsError,
};
