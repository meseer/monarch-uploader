/**
 * Wealthsimple Positions Service
 *
 * Handles fetching, mapping, and synchronizing Wealthsimple positions to Monarch holdings.
 *
 * Institution-specific logic lives here:
 * - Position fetching (managed vs self-directed API routing)
 * - Security mapping resolution (crypto auto-map, cash currencies, user prompts)
 * - Position data extraction (nested vs flat structure handling)
 * - Cash position handling (CAD/USD balances)
 *
 * Generic holding resolution/creation/deletion is delegated to the shared
 * holdingsSync orchestrator via HoldingsSyncHooks.
 */

import { debugLog } from '../../core/utils';
import type { ProgressDialog } from '../wealthsimple-upload';
import { INTEGRATIONS } from '../../core/integrationCapabilities';
import wealthsimpleApi from '../../api/wealthsimple';
import monarchApi from '../../api/monarch';
import accountService from '../common/accountService';
import {
  findExistingHolding,
  processAccountPositions as genericProcessAccountPositions,
} from '../common/holdingsSync';
import { showMonarchSecuritySelector } from '../../ui/components/securitySelector';
import toast from '../../ui/toast';
import type { HoldingsSyncHooks, MonarchHoldingsData } from '../../integrations/types';

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

// ── Helper Functions ──────────────────────────────────────────────────────────

/**
 * Check if an account type is a managed account
 */
export function isManagedAccount(accountType: string): boolean {
  return MANAGED_ACCOUNT_TYPES.has(accountType);
}

/**
 * Check if an account type is an investment account
 */
export function isInvestmentAccount(accountType: string): boolean {
  return INVESTMENT_ACCOUNT_TYPES.has(accountType);
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

// ── HoldingsSyncHooks Implementation ──────────────────────────────────────────

/**
 * Build Wealthsimple HoldingsSyncHooks.
 * Provides WS-specific data extraction for the generic holdings sync orchestrator.
 */
export function buildWealthsimpleHoldingsHooks(): HoldingsSyncHooks {
  return {
    getPositionKey: (position) => getPositionSecurityKey(position as unknown as WealthsimplePosition),

    getDisplaySymbol: (position) => getPositionDisplaySymbol(position as unknown as WealthsimplePosition),

    getQuantity: (position) => Math.abs(parseFloat(String((position as unknown as WealthsimplePosition).quantity)) || 0),

    buildHoldingUpdate: (position) => {
      const wsPos = position as unknown as WealthsimplePosition;
      const quantity = Math.abs(parseFloat(String(wsPos.quantity)) || 0);
      const sdPos = wsPos as SelfDirectedPosition;
      const costBasis = parseFloat(String(sdPos.averagePrice?.amount)) || 0;
      const updates: Record<string, unknown> = { quantity, costBasis };

      if (isManagedPositionFormat(wsPos)) {
        const managedTypeMap: Record<string, string> = {
          exchange_traded_fund: 'etf',
          currency: 'cash',
          mutual_fund: 'mutualFund',
          equity: 'equity',
          bond: 'bond',
        };
        const positionType = wsPos.type?.toLowerCase();
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

      return updates;
    },

    resolveSecurityMapping: (accountId, position) =>
      resolveSecurityMapping(accountId, position as unknown as WealthsimplePosition),

    getTickerForAutoRepair: (position) =>
      getSecuritySymbolForLookup(position as unknown as WealthsimplePosition),

    getAutoRepairSourceId: (position) => {
      const sdPos = position as unknown as SelfDirectedPosition;
      return sdPos.security?.id || undefined;
    },
  };
}

// ── Wealthsimple-Specific Functions ───────────────────────────────────────────

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

// ── Re-exports for backward compatibility ─────────────────────────────────────

// These re-exports allow existing code that imports from this module to continue
// working. The actual implementations now live in the shared holdingsSync module.
export { findHoldingById } from '../common/holdingsSync';

/**
 * Resolve or create holding for a position (delegates to shared holdingsSync)
 */
export async function resolveOrCreateHolding(
  accountId: string,
  monarchAccountId: string,
  monarchSecurityId: string,
  position: WealthsimplePosition,
  holdings: MonarchHoldingsData | null,
): Promise<string> {
  const { resolveOrCreateHolding: genericResolve } = await import('../common/holdingsSync');
  const hooks = buildWealthsimpleHoldingsHooks();
  return genericResolve(
    INTEGRATIONS.WEALTHSIMPLE, accountId, monarchAccountId, monarchSecurityId,
    position as unknown as Record<string, unknown>, holdings, hooks,
  );
}

/**
 * Sync position data to Monarch holding (delegates to shared holdingsSync)
 */
export async function syncPositionToHolding(holdingId: string, position: WealthsimplePosition): Promise<void> {
  const { syncPositionToHolding: genericSync } = await import('../common/holdingsSync');
  const hooks = buildWealthsimpleHoldingsHooks();
  return genericSync(holdingId, position as unknown as Record<string, unknown>, hooks);
}

/**
 * Detect and remove deleted holdings (delegates to shared holdingsSync)
 */
export async function detectAndRemoveDeletedHoldings(
  accountId: string,
  monarchAccountId: string,
  currentPositions: WealthsimplePosition[],
): Promise<{ deleted: number; autoRepaired: number }> {
  const { detectAndRemoveDeletedHoldings: genericDetect } = await import('../common/holdingsSync');
  const hooks = buildWealthsimpleHoldingsHooks();
  return genericDetect(
    INTEGRATIONS.WEALTHSIMPLE, accountId, monarchAccountId,
    currentPositions as unknown as Record<string, unknown>[], hooks,
  );
}

/**
 * Process positions for a single account (uses shared holdingsSync orchestrator)
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

    // Adapt the progress dialog to the HoldingsSyncProgress interface
    const progress = progressDialog ? {
      updateStatus: (status: string, message: string) => {
        progressDialog.updateStepStatus(accountId, 'positions', status, message);
      },
    } : null;

    // Delegate to shared orchestrator
    const hooks = buildWealthsimpleHoldingsHooks();
    const syncResult = await genericProcessAccountPositions(
      INTEGRATIONS.WEALTHSIMPLE, accountId, monarchAccountId,
      positions as unknown as Record<string, unknown>[], hooks, progress,
    );

    // Copy results
    result.success = syncResult.success;
    result.positionsProcessed = syncResult.positionsProcessed;
    result.positionsSkipped = syncResult.positionsSkipped;
    result.holdingsRemoved = syncResult.holdingsRemoved;
    result.mappingsAutoRepaired = syncResult.mappingsAutoRepaired;
    result.error = syncResult.error;

    // Show completion toast (WS-specific formatting)
    if (syncResult.success) {
      const toastParts = [`Synced ${result.positionsProcessed} positions for ${accountName}`];
      if (result.positionsSkipped > 0) toastParts.push(`${result.positionsSkipped} skipped`);
      if (result.mappingsAutoRepaired > 0) toastParts.push(`${result.mappingsAutoRepaired} repaired`);
      if (result.holdingsRemoved > 0) toastParts.push(`${result.holdingsRemoved} deleted`);

      const toastMsg = toastParts.length > 1
        ? `${toastParts[0]} (${toastParts.slice(1).join(', ')})`
        : toastParts[0];
      toast.show(toastMsg, 'info');
    }
  } catch (error: unknown) {
    debugLog(`Error processing account positions for ${accountId}:`, error);
    result.error = (error as Error).message;
    if (progressDialog) {
      progressDialog.updateStepStatus(accountId, 'positions', 'error', `Error: ${(error as Error).message}`);
    }
  }

  return result;
}

// ── Cash Position Handling (WS-specific) ──────────────────────────────────────

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
  holdings: MonarchHoldingsData | null,
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

  const existingHolding = findExistingHolding(monarchSecurityId, holdings);

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
    const holdings = (await monarchApi.getHoldings([monarchAccountId])) as MonarchHoldingsData | null;
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
  buildWealthsimpleHoldingsHooks,
};