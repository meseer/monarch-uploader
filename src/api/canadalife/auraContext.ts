/**
 * Aura context resolution for Canada Life.
 *
 * Salesforce requires an `aura.context` form parameter containing the current
 * framework version UID (`fwuid`). This value rotates whenever Salesforce
 * deploys a framework update; sending a stale one makes the server reply with
 * COOSE (Client Out Of Sync Error) warnings and silently failing actions.
 *
 * @module api/canadalife/auraContext
 */

import { debugLog } from '../../core/utils';

/** Fallback hardcoded aura.context — used only if every dynamic strategy fails */
const FALLBACK_AURA_CONTEXT = '{"mode":"PROD","fwuid":"eE5UbjZPdVlRT3M0d0xtOXc5MzVOQWg5TGxiTHU3MEQ5RnBMM0VzVXc1cmcxMi42MjkxNDU2LjE2Nzc3MjE2","app":"siteforce:communityApp","loaded":{"APPLICATION@markup://siteforce:communityApp":"1304_mrTwQgpga20ubVtg_n_l_A"},"dn":[],"globals":{},"uad":true}';

/** The Aura application this community runs */
const AURA_APP = 'siteforce:communityApp';

/**
 * Context harvested from a previous Aura *response*.
 *
 * Every Aura response echoes back the server's authoritative `context.fwuid`
 * and `context.loaded`, including responses for failed actions. Caching those
 * gives us a self-healing source of truth that does not depend on reaching the
 * page's `$A` object through the userscript sandbox.
 */
let harvestedContext: { fwuid: string; loaded: Record<string, unknown> } | null = null;

/**
 * Build a well-formed aura.context object.
 * @param fwuid - Framework version UID
 * @param mode - Aura mode (defaults to PROD)
 * @param loaded - Loaded-application descriptor map
 * @returns Context object ready to be JSON-stringified
 */
function buildContextObject(
  fwuid: string,
  mode = 'PROD',
  loaded: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    mode,
    fwuid,
    app: AURA_APP,
    loaded,
    dn: [],
    globals: {},
    uad: true,
  };
}

/**
 * Record the `context` block from an Aura response so later requests can reuse
 * the server's own `fwuid`.
 *
 * Safe to call with any parsed response — non-conforming input is ignored.
 *
 * @param responseData - Parsed Aura response body
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function harvestAuraContext(responseData: any): void {
  try {
    const fwuid = responseData?.context?.fwuid;
    if (typeof fwuid !== 'string' || fwuid === '') {
      return;
    }

    if (harvestedContext?.fwuid === fwuid) {
      return;
    }

    harvestedContext = {
      fwuid,
      loaded: responseData.context.loaded || {},
    };
    debugLog('Harvested aura.context fwuid from server response', { fwuid });
  } catch (error) {
    debugLog('Error harvesting aura.context from response:', error);
  }
}

/**
 * Clear the harvested context cache (useful for testing or forced refresh).
 */
export function clearHarvestedAuraContext(): void {
  harvestedContext = null;
}

/**
 * Resolve the page's Aura runtime object.
 *
 * Userscripts run in an isolated sandbox in some managers, so `window.$A` may
 * be undefined while `unsafeWindow.$A` (the real page object) is present.
 *
 * @returns The `$A` object, or null if unreachable
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveAuraRuntime(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fromWindow = (window as any)?.$A;
  if (fromWindow) {
    return fromWindow;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsafe = (globalThis as any).unsafeWindow;
    if (unsafe?.$A) {
      debugLog('Resolved $A via unsafeWindow (sandboxed userscript context)');
      return unsafe.$A;
    }
  } catch {
    // unsafeWindow is unavailable (not granted, or not a userscript context)
  }

  return null;
}

/**
 * Extract the aura.context from the page's `$A` runtime.
 *
 * Strategy 1: `$A.getContext().encodeForServer()` — canonical serialisation.
 * Strategy 2: build manually from `fwuid` / `getEncodedFwuid()`.
 *
 * @returns JSON string, or null if `$A` is unusable
 */
function extractContextFromRuntime(): string | null {
  const $A = resolveAuraRuntime();

  if (!$A || typeof $A.getContext !== 'function') {
    return null;
  }

  const ctx = $A.getContext();

  // Strategy 1 – encodeForServer (best: includes everything the server expects)
  if (ctx && typeof ctx.encodeForServer === 'function') {
    const encoded = ctx.encodeForServer();
    if (encoded) {
      const json = typeof encoded === 'string' ? encoded : JSON.stringify(encoded);
      debugLog('Extracted aura.context via $A.getContext().encodeForServer()');
      return json;
    }
  }

  // Strategy 2 – build manually from context properties
  if (ctx) {
    const fwuid = ctx.fwuid
      || (typeof ctx.getEncodedFwuid === 'function' ? ctx.getEncodedFwuid() : null);

    if (fwuid) {
      const json = JSON.stringify(buildContextObject(fwuid, ctx.mode, ctx.loaded || {}));
      debugLog('Built aura.context manually from $A.getContext() properties', { fwuid });
      return json;
    }
  }

  return null;
}

/**
 * Attempt to extract the aura.context from inline `<script>` tags that
 * Salesforce injects during page bootstrap. The pattern typically looks like:
 *   $A.initConfig({...});  or  Aura.initConfig({...});
 * which contains the `fwuid` we need.
 *
 * @returns JSON string, or null if extraction fails
 */
function extractAuraContextFromPage(): string | null {
  try {
    const scripts = document.querySelectorAll('script:not([src])');
    for (const script of scripts) {
      const text = script.textContent || '';

      // Look for Aura.initConfig or $A.initConfig patterns
      const match = text.match(/(?:\$A|Aura)\.initConfig\s*\(\s*(\{[\s\S]*?\})\s*\)/);
      if (match?.[1]) {
        try {
          const config = JSON.parse(match[1]);
          if (config.context?.fwuid) {
            return JSON.stringify(buildContextObject(
              config.context.fwuid,
              config.context.mode,
              config.context.loaded || {},
            ));
          }
        } catch {
          // JSON parse failed for this match, continue searching
        }
      }

      // Also look for a direct fwuid string in auraConfig-style objects
      const fwuidMatch = text.match(/"fwuid"\s*:\s*"([A-Za-z0-9_+/=-]+)"/);
      if (fwuidMatch?.[1]) {
        return JSON.stringify(buildContextObject(fwuidMatch[1]));
      }
    }
  } catch (error) {
    debugLog('Error parsing page scripts for aura.context:', error);
  }

  return null;
}

/**
 * Build the `aura.context` form parameter for a Canada Life request.
 *
 * Strategies are tried in order of reliability:
 *  1. `$A.getContext()` from the page runtime (`window` then `unsafeWindow`)
 *  2. `fwuid` harvested from a previous Aura response (server's own value)
 *  3. The Aura bootstrap `<script>` tag in the page HTML
 *  4. The hardcoded fallback constant (last resort — likely stale)
 *
 * @returns JSON string suitable for the `aura.context` form parameter
 */
export function getAuraContext(): string {
  try {
    const fromRuntime = extractContextFromRuntime();
    if (fromRuntime) {
      return fromRuntime;
    }

    // Strategy 2 – reuse the fwuid the server told us about most recently
    if (harvestedContext) {
      debugLog('Using aura.context fwuid harvested from a previous response', {
        fwuid: harvestedContext.fwuid,
      });
      return JSON.stringify(buildContextObject(
        harvestedContext.fwuid,
        'PROD',
        harvestedContext.loaded,
      ));
    }

    // Strategy 3 – parse the Aura bootstrap script in the page HTML
    const bootstrapContext = extractAuraContextFromPage();
    if (bootstrapContext) {
      debugLog('Extracted aura.context from page bootstrap script');
      return bootstrapContext;
    }
  } catch (error) {
    debugLog('Error extracting dynamic aura.context, using fallback:', error);
  }

  debugLog('WARNING: Using hardcoded fallback aura.context — this may become stale');
  return FALLBACK_AURA_CONTEXT;
}