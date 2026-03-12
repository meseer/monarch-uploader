/**
 * Wealthsimple Positions Service
 * Handles fetching, mapping, and synchronizing Wealthsimple positions to Monarch holdings
 */

import { debugLog } from '../../core/utils';
import type { ProgressDialog } from '../wealthsimple-upload';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import wealthsimpleApi from '../../api/wealthsimple';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import { showMonarchSecuritySelector } from '../../ui/components/securitySelector';
import toast from '../../ui/toast';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PositionSecurity {
  id?: string;
  securityType?: string;
  stock?: { symbol?: string; name?: string };
  optionDetails?: { osiSymbol?: string };
  quoteV2?: { price?: number | string };
}

/** Self-directed position (nested security structure) */
interface SelfDirectedPosition {
  security: PositionSecurity;
  symbol?: undefined;
  id?: string;
  quantity?: string | number;
  averagePrice?: { amount?: string | number };
  totalValue?: { amount?: string | number };
  name?: string;
  type?: string;
}

/** Managed portfolio position (flat structure with symbol directly on position) */
interface ManagedPosition {
  symbol: string;
  security?: undefined;
  id?: string;
  quantity?: string | number;
  value?: string | number;
  name?: string;
  type?: string;
}

export type WealthsimplePosition = SelfDirectedPosition | ManagedPosition;

interface HoldingMapping {
  securityId?: string;
  holdingId?: string | null;
  symbol?: string;
}

interface MonarchHolding {
  id: string;
  ticker?: string;
  isManual?: boolean;
}

interface AggregateHolding {
  security?: { id?: string };
  holdings?: MonarchHolding[];
}

interface MonarchHoldings {
  aggregateHoldings?: {
    edges?: Array<{ node: AggregateHolding }>;
  };
}

export interface PositionResult {
  success: boolean;
  positionsProcessed: number;
  positionsSkipped: number;
  holdingsRemoved: number;
  mappingsAutoRepaired: number;
  error: string | null;
}

export interface CashPositionResult {
  success: boolean;
  cashSynced: number;
  cashSkipped: number;
  error: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Hardcoded Monarch security IDs for cash currencies
 * These are well-known securities in Monarch for representing cash holdings
 */
const MONARCH_CASH_SECURITY_IDS: Record<string, string> = {
  CAD: '207574838264130301', // Canadian Dollar (CUR:CAD)
  USD: '77359007714940929', // US Dollar (CUR:USD)
};

/**
 * Cash holding storage keys (used in holdingsMappings)
 * These are virtual security IDs used to store Monarch holding IDs for cash positions
 */
const CASH_HOLDING_KEYS: Record<string, string> = {
  CAD: 'cash-cad',
  USD: 'cash-usd',
};

/**
 * MANAGED_* account types that should use FetchAccountManagedPortfolioPositions API
 */
const MANAGED_ACCOUNT_TYPES = new Set([
  'MANAGED_RESP_FAMILY',
  'MANAGED_RESP',
  'MANAGED_NON_REGISTERED',
  'MANAGED_TFSA',
  'MANAGED_RRSP',
]);

/**
 * Check if an account type is a managed account
 */
export function isManagedAccount(accountType: string): boolean {
  return MANAGED_ACCOUNT_TYPES.has(accountType);
}

/**
 * Custom positions error class
 */
export class PositionsError extends Error {
  accountId: string | null;
  position: WealthsimplePosition | null;

  constructor(message: string, accountId: string | null, position: WealthsimplePosition | null = null) {
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
  'SELF_DIRECTED_NON_REGISTERED_MARGIN',
]);

/**
 * Check if an account type is an investment account
 */
export function isInvestmentAccount(accountType: string): boolean {
  return INVESTMENT_ACCOUNT_TYPES.has(accountType);
}

/**
 * Get the symbol to use for security lookup in Monarch
 * For options: use osiSymbol with whitespace removed
 * For stocks/ETFs: use stock symbol
 */
export function getSecuritySymbolForLookup(position: WealthsimplePosition): string | null {
  const security = (position as SelfDirectedPosition).security;
  if (!security) {
    return null;
  }

  // Check if this is an option
  if (security.securityType === 'OPTION' && security.optionDetails?.osiSymbol) {
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
 * Handles both self-directed positions (nested structure) and managed positions (flat structure)
 */
function getSecurityName(position: WealthsimplePosition): string {
  // Managed positions have name directly on position
  if (position.name) {
    return position.name;
  }

  const security = (position as SelfDirectedPosition).security;
  if (!security) {
    return 'Unknown';
  }

  if (security.stock?.name) {
    return security.stock.name;
  }

  if (security.optionDetails?.osiSymbol) {
    return security.optionDetails.osiSymbol;
  }

  return security.id || 'Unknown';
}

/**
 * Check if a position is from the managed portfolio API (flat structure)
 * Managed positions have 'symbol' directly on the position object
 * Self-directed positions have nested security.stock.symbol
 */
function isManagedPositionFormat(position: WealthsimplePosition): position is ManagedPosition {
  return (position as ManagedPosition).symbol !== undefined && !(position as SelfDirectedPosition).security;
}

/**
 * Check if a managed portfolio position is a cash currency position
 */
function isManagedCashPosition(position: WealthsimplePosition): boolean {
  if (!isManagedPositionFormat(position)) return false;
  return position.symbol === 'CAD' || position.symbol === 'USD';
}

/**
 * Get the security ID key for a position
 * For managed positions: uses symbol (or cash-cad/cash-usd for currencies)
 * For self-directed positions: uses security.id
 */
function getPositionSecurityKey(position: WealthsimplePosition): string | undefined {
  if (isManagedPositionFormat(position)) {
    if (position.symbol === 'CAD') return CASH_HOLDING_KEYS.CAD;
    if (position.symbol === 'USD') return CASH_HOLDING_KEYS.USD;
    return position.id || position.symbol;
  }
  return (position as SelfDirectedPosition).security?.id;
}

/**
 * Get the symbol to display/lookup for any position type
 */
function getPositionDisplaySymbol(position: WealthsimplePosition): string | null {
  if (isManagedPositionFormat(position)) {
    if (position.symbol === 'CAD') return 'CUR:CAD';
    if (position.symbol === 'USD') return 'CUR:USD';
    return position.symbol;
  }
  return getSecuritySymbolForLookup(position);
}

/**
 * Fetch positions for a Wealthsimple account
 * Routes to appropriate API based on account type:
 * - MANAGED_* accounts: Uses FetchAccountManagedPortfolioPositions API
 * - SELF_DIRECTED_* accounts: Uses FetchIdentityPositions API
 */
export async function fetchPositions(accountId: string, accountType: string | null = null): Promise<WealthsimplePosition[]> {
  try {
    debugLog(`Fetching positions for account ${accountId} (type: ${accountType})`);

    if (!accountId) {
      throw new PositionsError('Account ID is required', accountId);
    }

    if (accountType && isManagedAccount(accountType)) {
      debugLog(`Using FetchAccountManagedPortfolioPositions API for managed account ${accountId}`);
      const positions = (await wealthsimpleApi.fetchManagedPortfolioPositions(accountId)) as WealthsimplePosition[];
      debugLog(`Fetched ${positions.length} managed portfolio positions for account ${accountId}`);
      return Array.isArray(positions) ? positions : [];
    }

    const positions = (await wealthsimpleApi.fetchIdentityPositions(accountId)) as WealthsimplePosition[];
    debugLog(`Fetched ${positions.length} positions for account ${accountId}`);
    return Array.isArray(positions) ? positions : [];
  } catch (error: unknown) {
    debugLog(`Error fetching positions for account ${accountId}:`, error);
    throw new PositionsError(`Failed to fetch positions: ${(error as Error).message}`, accountId);
  }
}

/**
 * Resolve security mapping for a position
 * For managed positions with CAD/USD symbols, automatically maps to hardcoded Monarch security IDs
 */
export async function resolveSecurityMapping(accountId: string, position: WealthsimplePosition): Promise<string | null> {
  try {
    const securityKey = getPositionSecurityKey(position);
    if (!securityKey) {
      throw new PositionsError('Position missing security ID', accountId, position);
    }

    const symbol = getPositionDisplaySymbol(position);

    // For managed cash positions (CAD/USD), automatically use hardcoded Monarch security IDs
    if (isManagedCashPosition(position)) {
      const managedPos = position as ManagedPosition;
      const monarchSecurityId = MONARCH_CASH_SECURITY_IDS[managedPos.symbol];
      debugLog(`Auto-mapped managed cash position ${managedPos.symbol} to Monarch security ${monarchSecurityId}`);
      return monarchSecurityId;
    }

    // Check for existing mapping using accountService (unified structure)
    const existingMapping = accountService.getHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, securityKey) as HoldingMapping | null;
    if (existingMapping?.securityId) {
      debugLog(`Found existing security mapping for ${symbol}: ${existingMapping.securityId}`);
      return existingMapping.securityId;
    }

    // For crypto positions, try auto-mapping to {symbol}-USD in Monarch
    const securityType = isManagedPositionFormat(position)
      ? position.type
      : (position as SelfDirectedPosition).security?.securityType;

    if (securityType === 'CRYPTOCURRENCY' || securityType === 'cryptocurrency') {
      const cryptoSearchTerm = `${symbol}-USD`;
      debugLog(`Crypto position detected (${symbol}), auto-searching Monarch for ${cryptoSearchTerm}`);

      try {
        const searchResults = (await monarchApi.searchSecurities(cryptoSearchTerm, { limit: 5 })) as Array<{ id: string; name: string; ticker: string }>;
        const exactMatch = searchResults.find((s) => s.ticker === cryptoSearchTerm);

        if (exactMatch) {
          debugLog(`Auto-mapped crypto ${symbol} to Monarch security ${exactMatch.name} (${exactMatch.id}, ticker: ${exactMatch.ticker})`);
          accountService.saveHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, securityKey, {
            securityId: exactMatch.id,
            symbol,
          });
          return exactMatch.id;
        }

        debugLog(`No exact match for ${cryptoSearchTerm} in Monarch, falling through to manual selector`);
      } catch (error: unknown) {
        debugLog(`Error auto-searching crypto symbol ${cryptoSearchTerm}:`, error);
      }
    }

    debugLog(`No mapping found for ${symbol}, showing security selector`);

    const sdPos = position as SelfDirectedPosition;
    const positionInfo = {
      security: {
        symbol,
        name: getSecurityName(position),
        securityType: isManagedPositionFormat(position) ? position.type : sdPos.security?.securityType,
      },
      openQuantity: Math.abs(parseFloat(String(position.quantity)) || 0),
      currentMarketValue: parseFloat(String(isManagedPositionFormat(position) ? (position as ManagedPosition).value : sdPos.totalValue?.amount)) || 0,
      currentPrice: parseFloat(String(sdPos.security?.quoteV2?.price)) || 0,
    };

    const selectedSecurity = await new Promise<{ id: string; name: string } | null>((resolve) => {
      showMonarchSecuritySelector(positionInfo, resolve as (result: unknown) => void);
    });

    if (!selectedSecurity) {
      debugLog(`User cancelled security selection for ${symbol}`);
      return null;
    }

    debugLog(`Selected security: ${symbol} (${securityKey}) -> ${selectedSecurity.name} (${selectedSecurity.id})`);
    return selectedSecurity.id;
  } catch (error: unknown) {
    debugLog('Error resolving security mapping for position:', error);
    throw new PositionsError(`Failed to resolve security mapping: ${(error as Error).message}`, accountId, position);
  }
}

/**
 * Find existing holding for a security in Monarch account
 */
function findExistingHolding(monarchAccountId: string, securityId: string, holdings: MonarchHoldings | null): MonarchHolding | null {
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

/**
 * Resolve or create holding for a position
 */
export async function resolveOrCreateHolding(
  accountId: string,
  monarchAccountId: string,
  monarchSecurityId: string,
  position: WealthsimplePosition,
  holdings: MonarchHoldings | null,
): Promise<string> {
  try {
    const securityKey = getPositionSecurityKey(position);
    const symbol = getPositionDisplaySymbol(position);

    const existingMapping = accountService.getHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, securityKey as string) as HoldingMapping | null;
    if (existingMapping?.holdingId) {
      debugLog(`Found stored holding ID for ${symbol}: ${existingMapping.holdingId}`);
      return existingMapping.holdingId;
    }

    const existingHolding = findExistingHolding(monarchAccountId, monarchSecurityId, holdings);

    if (existingHolding) {
      debugLog(`Found existing holding in Monarch for ${symbol}: ${existingHolding.id}`);
      accountService.saveHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, securityKey as string, {
        securityId: monarchSecurityId,
        holdingId: existingHolding.id,
        symbol,
      });
      return existingHolding.id;
    }

    const quantity = Math.abs(parseFloat(String(position.quantity)) || 0);
    debugLog(`Creating new holding for ${symbol} in Monarch account ${monarchAccountId}, quantity: ${quantity}`);

    const newHolding = (await monarchApi.createManualHolding(monarchAccountId, monarchSecurityId, quantity)) as { id: string };

    accountService.saveHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, securityKey as string, {
      securityId: monarchSecurityId,
      holdingId: newHolding.id,
      symbol,
    });

    debugLog(`Created and saved holding: ${symbol} -> ${newHolding.id}`);
    return newHolding.id;
  } catch (error: unknown) {
    debugLog('Error resolving/creating holding for position:', error);
    throw new PositionsError(`Failed to resolve or create holding: ${(error as Error).message}`, accountId, position);
  }
}

/**
 * Sync position data to Monarch holding
 */
export async function syncPositionToHolding(holdingId: string, position: WealthsimplePosition): Promise<void> {
  try {
    const symbol = getPositionDisplaySymbol(position);
    debugLog(`Syncing position ${symbol} to holding ${holdingId}`);

    const quantity = Math.abs(parseFloat(String(position.quantity)) || 0);
    const sdPos = position as SelfDirectedPosition;
    const costBasis = parseFloat(String(sdPos.averagePrice?.amount)) || 0;

    const updates: Record<string, unknown> = { quantity, costBasis };

    if (isManagedPositionFormat(position)) {
      const managedTypeMap: Record<string, string> = {
        exchange_traded_fund: 'etf',
        currency: 'cash',
        mutual_fund: 'mutualFund',
        equity: 'equity',
        bond: 'bond',
      };
      const positionType = position.type?.toLowerCase();
      updates.securityType = (positionType && managedTypeMap[positionType]) ? managedTypeMap[positionType] : 'etf';
    } else {
      const securityType = sdPos.security?.securityType;
      if (securityType) {
        const typeMap: Record<string, string> = {
          EQUITY: 'equity',
          OPTION: 'option',
          BOND: 'bond',
          EXCHANGE_TRADED_FUND: 'etf',
          MUTUAL_FUND: 'mutualFund',
        };
        updates.securityType = typeMap[securityType] || 'equity';
      }
    }

    await monarchApi.updateHolding(holdingId, updates);
    debugLog(`Successfully synced ${symbol}: quantity=${quantity}, costBasis=${costBasis}`);
  } catch (error: unknown) {
    debugLog('Error syncing position to holding:', error);
    throw new PositionsError(`Failed to sync position: ${(error as Error).message}`, null, position);
  }
}

/**
 * Detect and remove deleted holdings
 */
export async function detectAndRemoveDeletedHoldings(
  accountId: string,
  monarchAccountId: string,
  currentPositions: WealthsimplePosition[],
): Promise<{ deleted: number; autoRepaired: number }> {
  let deletedCount = 0;
  let autoRepairedCount = 0;

  try {
    debugLog(`Detecting deleted holdings for account ${accountId}`);

    const portfolio = (await monarchApi.getHoldings([monarchAccountId])) as MonarchHoldings | null;

    if (!portfolio?.aggregateHoldings?.edges) {
      debugLog('No holdings found in Monarch');
      return { deleted: 0, autoRepaired: 0 };
    }

    const mappings = (accountService.getHoldingsMappings(INTEGRATIONS.WEALTHSIMPLE, accountId) || {}) as Record<string, HoldingMapping>;

    const currentPositionKeys = new Set<string>();
    for (const position of currentPositions) {
      const key = getPositionSecurityKey(position);
      if (key) currentPositionKeys.add(key);
    }

    const positionsBySymbol = new Map<string, WealthsimplePosition>();
    for (const position of currentPositions) {
      const symbol = getSecuritySymbolForLookup(position);
      if (symbol) positionsBySymbol.set(symbol, position);
    }

    debugLog(`Found ${portfolio.aggregateHoldings.edges.length} aggregate holdings in Monarch, ${currentPositionKeys.size} Wealthsimple positions`);

    for (const edge of portfolio.aggregateHoldings.edges) {
      const aggregateHolding = edge.node;

      if (!aggregateHolding.holdings || !Array.isArray(aggregateHolding.holdings)) {
        continue;
      }

      for (const holding of aggregateHolding.holdings) {
        const holdingId = holding.id;
        const ticker = holding.ticker;

        if (!holdingId || !ticker) continue;

        const mappingEntry = Object.entries(mappings).find(([, m]) => m.holdingId === holdingId);

        if (mappingEntry) {
          const [mappingKey, mappingData] = mappingEntry;

          if (currentPositionKeys.has(mappingKey)) {
            debugLog(`Holding ${ticker} (${holdingId}) has mapping and position exists, keeping`);
            continue;
          }

          try {
            debugLog(`Deleting holding for sold position: ${ticker} (${holdingId}) - position no longer exists`);
            await monarchApi.deleteHolding(holdingId);
            debugLog(`Successfully deleted holding ${ticker}`);
            deletedCount += 1;

            accountService.saveHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, mappingKey, {
              securityId: mappingData.securityId,
              holdingId: null,
              symbol: mappingData.symbol,
            });
            debugLog(`Cleared holdingId from mapping for ${ticker}, preserved securityId ${mappingData.securityId}`);
          } catch (error: unknown) {
            debugLog(`Failed to delete holding ${ticker} (${holdingId}):`, error);
          }
          continue;
        }

        const matchingPosition = positionsBySymbol.get(ticker);

        if (matchingPosition) {
          const wsSecurityId = (matchingPosition as SelfDirectedPosition).security?.id;
          const monarchSecurityId = aggregateHolding.security?.id;

          if (wsSecurityId && monarchSecurityId) {
            debugLog(`Auto-repairing mapping for ${ticker}: wsSecurityId=${wsSecurityId}, holdingId=${holdingId}`);
            accountService.saveHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, wsSecurityId, {
              securityId: monarchSecurityId,
              holdingId,
              symbol: ticker,
            });
            autoRepairedCount += 1;
          }
        } else {
          try {
            debugLog(`Deleting orphaned holding: ${ticker} (${holdingId}) - no matching Wealthsimple position`);
            await monarchApi.deleteHolding(holdingId);
            debugLog(`Successfully deleted holding ${ticker}`);
            deletedCount += 1;
          } catch (error: unknown) {
            debugLog(`Failed to delete holding ${ticker} (${holdingId}):`, error);
          }
        }
      }
    }

    debugLog(`Deletion complete: ${deletedCount} deleted, ${autoRepairedCount} auto-repaired`);
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  } catch (error: unknown) {
    debugLog('Error detecting deleted holdings:', error);
    return { deleted: deletedCount, autoRepaired: autoRepairedCount };
  }
}

/**
 * Process positions for a single account
 */
export async function processAccountPositions(
  accountId: string,
  accountName: string,
  monarchAccountId: string,
  progressDialog: ProgressDialog | null = null,
  accountType: string | null = null,
): Promise<PositionResult> {
  const result: PositionResult = {
    success: false,
    positionsProcessed: 0,
    positionsSkipped: 0,
    holdingsRemoved: 0,
    mappingsAutoRepaired: 0,
    error: null,
  };

  try {
    debugLog(`Processing positions for account ${accountName} (${accountId}, type: ${accountType})`);
    toast.show(`Starting positions sync for ${accountName}...`, 'debug');

    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'processing', 'Fetching positions...');
    }

    const positions = await fetchPositions(accountId, accountType);

    if (!positions || positions.length === 0) {
      debugLog(`No positions found for account ${accountId}`);
      toast.show(`No positions found for ${accountName}`, 'debug');
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

    const holdings = (await monarchApi.getHoldings([monarchAccountId])) as MonarchHoldings | null;

    for (let i = 0; i < positions.length; i += 1) {
      const position = positions[i];
      const symbol = getPositionDisplaySymbol(position) || 'Unknown';

      try {
        if (progressDialog) {
          progressDialog.updateStepStatus(
            accountId,
            'positions',
            'processing',
            `Processing ${i + 1}/${positions.length}: ${symbol}...`,
          );
        }

        const monarchSecurityId = await resolveSecurityMapping(accountId, position);

        if (!monarchSecurityId) {
          debugLog(`Skipping position ${symbol} (user cancelled)`);
          result.positionsSkipped += 1;
          continue;
        }

        const holdingId = await resolveOrCreateHolding(accountId, monarchAccountId, monarchSecurityId, position, holdings);
        await syncPositionToHolding(holdingId, position);

        result.positionsProcessed += 1;
        debugLog(`Successfully processed position ${symbol}`);
      } catch (error: unknown) {
        debugLog(`Error processing position ${symbol}:`, error);
        result.positionsSkipped += 1;
      }
    }

    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'processing', 'Checking for deleted positions...');
    }

    const deletionResult = await detectAndRemoveDeletedHoldings(accountId, monarchAccountId, positions);
    result.holdingsRemoved = deletionResult.deleted;
    result.mappingsAutoRepaired = deletionResult.autoRepaired;
    result.success = true;

    let statusMsg = `${result.positionsProcessed} synced`;
    if (result.mappingsAutoRepaired > 0) statusMsg += `, ${result.mappingsAutoRepaired} repaired`;
    if (result.holdingsRemoved > 0) statusMsg += `, ${result.holdingsRemoved} deleted`;

    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'success', statusMsg);
    }

    const toastParts = [`Synced ${result.positionsProcessed} positions for ${accountName}`];
    if (result.positionsSkipped > 0) toastParts.push(`${result.positionsSkipped} skipped`);
    if (result.mappingsAutoRepaired > 0) toastParts.push(`${result.mappingsAutoRepaired} repaired`);
    if (result.holdingsRemoved > 0) toastParts.push(`${result.holdingsRemoved} deleted`);

    const toastMsg = toastParts.length > 1
      ? `${toastParts[0]} (${toastParts.slice(1).join(', ')})`
      : toastParts[0];
    toast.show(toastMsg, 'info');

    debugLog(`Completed processing positions for ${accountName}: ${result.positionsProcessed} processed, ${result.positionsSkipped} skipped, ${result.mappingsAutoRepaired} repaired, ${result.holdingsRemoved} deleted`);
  } catch (error: unknown) {
    debugLog(`Error processing account positions for ${accountId}:`, error);
    result.error = (error as Error).message;
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'error', `Error: ${(error as Error).message}`);
    }
  }

  return result;
}

/**
 * Fetch cash balances for an investment account
 */
export async function fetchCashBalances(accountId: string): Promise<{ cad: number | null; usd: number | null }> {
  try {
    debugLog(`Fetching cash balances for account ${accountId}`);

    if (!accountId) {
      throw new PositionsError('Account ID is required for cash balance fetch', accountId);
    }

    const balances = (await wealthsimpleApi.fetchAccountsWithBalance([accountId])) as Record<string, { cad: number | null; usd: number | null }>;
    const accountBalances = balances[accountId];

    if (!accountBalances) {
      debugLog(`No cash balance data returned for account ${accountId}`);
      return { cad: null, usd: null };
    }

    debugLog(`Cash balances for ${accountId}: CAD=${accountBalances.cad}, USD=${accountBalances.usd}`);
    return accountBalances;
  } catch (error: unknown) {
    debugLog(`Error fetching cash balances for account ${accountId}:`, error);
    throw new PositionsError(`Failed to fetch cash balances: ${(error as Error).message}`, accountId);
  }
}

/**
 * Resolve or create a cash holding in Monarch
 */
async function resolveOrCreateCashHolding(
  accountId: string,
  monarchAccountId: string,
  currency: string,
  holdings: MonarchHoldings | null,
): Promise<string> {
  const cashHoldingKey = CASH_HOLDING_KEYS[currency];
  const monarchSecurityId = MONARCH_CASH_SECURITY_IDS[currency];
  const symbol = `CUR:${currency}`;

  if (!cashHoldingKey || !monarchSecurityId) {
    throw new PositionsError(`Unsupported currency for cash holding: ${currency}`, accountId);
  }

  const existingMapping = accountService.getHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, cashHoldingKey) as HoldingMapping | null;
  if (existingMapping?.holdingId) {
    debugLog(`Found stored cash holding ID for ${currency}: ${existingMapping.holdingId}`);
    return existingMapping.holdingId;
  }

  const existingHolding = findExistingHolding(monarchAccountId, monarchSecurityId, holdings);

  if (existingHolding) {
    debugLog(`Found existing cash holding in Monarch for ${currency}: ${existingHolding.id}`);
    accountService.saveHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, cashHoldingKey, {
      securityId: monarchSecurityId,
      holdingId: existingHolding.id,
      symbol,
    });
    return existingHolding.id;
  }

  debugLog(`Creating new cash holding for ${currency} in Monarch account ${monarchAccountId}`);
  const newHolding = (await monarchApi.createManualHolding(monarchAccountId, monarchSecurityId, 0)) as { id: string };

  accountService.saveHoldingMapping(INTEGRATIONS.WEALTHSIMPLE, accountId, cashHoldingKey, {
    securityId: monarchSecurityId,
    holdingId: newHolding.id,
    symbol,
  });

  debugLog(`Created and saved cash holding: ${currency} -> ${newHolding.id}`);
  return newHolding.id;
}

async function syncCashToHolding(holdingId: string, quantity: number, currency: string): Promise<void> {
  try {
    debugLog(`Syncing ${currency} cash balance ${quantity} to holding ${holdingId}`);
    const updates = { quantity, costBasis: 1, securityType: 'cash' };
    await monarchApi.updateHolding(holdingId, updates);
    debugLog(`Successfully synced ${currency} cash: quantity=${quantity}`);
  } catch (error: unknown) {
    debugLog(`Error syncing cash to holding ${holdingId}:`, error);
    throw new PositionsError(`Failed to sync ${currency} cash: ${(error as Error).message}`, null);
  }
}

export async function processCashPositions(
  accountId: string,
  accountName: string,
  monarchAccountId: string,
  progressDialog: ProgressDialog | null = null,
): Promise<CashPositionResult> {
  const result: CashPositionResult = { success: false, cashSynced: 0, cashSkipped: 0, error: null };
  try {
    debugLog(`Processing cash positions for account ${accountName} (${accountId})`);
    if (progressDialog) progressDialog.updateStepStatus(accountId, 'cashSync', 'processing', 'Fetching cash balances...');
    const cashBalances = await fetchCashBalances(accountId);
    const holdings = (await monarchApi.getHoldings([monarchAccountId])) as MonarchHoldings | null;
    if (cashBalances.cad !== null) {
      try {
        if (progressDialog) progressDialog.updateStepStatus(accountId, 'cashSync', 'processing', 'Syncing CAD cash...');
        const cadHoldingId = await resolveOrCreateCashHolding(accountId, monarchAccountId, 'CAD', holdings);
        await syncCashToHolding(cadHoldingId, cashBalances.cad, 'CAD');
        result.cashSynced += 1;
      } catch (error: unknown) { debugLog('Failed to sync CAD cash:', error); result.cashSkipped += 1; }
    }
    if (cashBalances.usd !== null) {
      try {
        if (progressDialog) progressDialog.updateStepStatus(accountId, 'cashSync', 'processing', 'Syncing USD cash...');
        const usdHoldingId = await resolveOrCreateCashHolding(accountId, monarchAccountId, 'USD', holdings);
        await syncCashToHolding(usdHoldingId, cashBalances.usd, 'USD');
        result.cashSynced += 1;
      } catch (error: unknown) { debugLog('Failed to sync USD cash:', error); result.cashSkipped += 1; }
    }
    result.success = true;
    let statusMsg: string;
    if (result.cashSynced === 0 && result.cashSkipped === 0) statusMsg = 'No cash balances';
    else if (result.cashSkipped === 0) statusMsg = `${result.cashSynced} currency synced`;
    else statusMsg = `${result.cashSynced} synced, ${result.cashSkipped} skipped`;
    if (progressDialog) progressDialog.updateStepStatus(accountId, 'cashSync', 'success', statusMsg);
    debugLog(`Completed cash sync for ${accountName}: ${result.cashSynced} synced, ${result.cashSkipped} skipped`);
  } catch (error: unknown) {
    debugLog(`Error processing cash positions for ${accountId}:`, error);
    result.error = (error as Error).message;
    if (progressDialog) progressDialog.updateStepStatus(accountId, 'cashSync', 'error', `Error: ${(error as Error).message}`);
  }
  return result;
}

export default {
  isManagedAccount, isInvestmentAccount, fetchPositions, resolveSecurityMapping,
  resolveOrCreateHolding, syncPositionToHolding, detectAndRemoveDeletedHoldings,
  processAccountPositions, getSecuritySymbolForLookup, fetchCashBalances,
  processCashPositions, PositionsError, MONARCH_CASH_SECURITY_IDS,
};
