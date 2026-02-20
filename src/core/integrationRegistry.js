/**
 * Integration Registry
 *
 * Runtime registry of loaded integration modules. Each integration registers
 * its manifest, API client, auth handler, enrichment fetcher, injection point
 * config, and monarch mapper.
 *
 * The registry serves as the single source of truth for which integrations
 * are available at runtime and provides lookup methods for the core
 * orchestrator, settings UI, and site detection logic.
 *
 * @module core/integrationRegistry
 */

import { debugLog } from './utils';

/**
 * @typedef {Object} RegisteredIntegration
 * @property {IntegrationManifest} manifest - Integration manifest with capabilities, settings, etc.
 * @property {Object} api - Instantiated API client for this integration
 * @property {Object} auth - Instantiated auth handler for this integration
 * @property {Object|null} enrichment - Instantiated enrichment fetcher (null if not applicable)
 * @property {Object} injectionPoint - UI injection point configuration
 * @property {Object|null} monarchMapper - Monarch data mapper (null if not applicable)
 * @property {import('../integrations/types').SyncHooks|null} syncHooks - Sync hooks for the orchestrator (null if not applicable)
 */

/**
 * Internal registry map: integrationId → RegisteredIntegration
 * @type {Map<string, RegisteredIntegration>}
 */
const registry = new Map();

/**
 * Register an integration module in the runtime registry.
 *
 * Should be called during application bootstrap for each integration
 * that is included in the build.
 *
 * @param {Object} params - Integration components to register
 * @param {IntegrationManifest} params.manifest - Integration manifest
 * @param {Object} params.api - Instantiated API client
 * @param {Object} params.auth - Instantiated auth handler
 * @param {Object} [params.enrichment=null] - Instantiated enrichment fetcher
 * @param {Object} params.injectionPoint - UI injection point configuration
 * @param {Object} [params.monarchMapper=null] - Monarch data mapper
 * @param {import('../integrations/types').SyncHooks} [params.syncHooks=null] - Sync hooks for the orchestrator
 * @returns {boolean} True if registration succeeded
 */
export function registerIntegration({
  manifest,
  api,
  auth,
  enrichment = null,
  injectionPoint,
  monarchMapper = null,
  syncHooks = null,
}) {
  if (!manifest || !manifest.id) {
    debugLog('[integrationRegistry] Cannot register integration: missing manifest or manifest.id');
    return false;
  }

  if (registry.has(manifest.id)) {
    debugLog(`[integrationRegistry] Integration "${manifest.id}" is already registered, replacing`);
  }

  registry.set(manifest.id, {
    manifest,
    api,
    auth,
    enrichment,
    injectionPoint,
    monarchMapper,
    syncHooks,
  });

  debugLog(`[integrationRegistry] Registered integration: ${manifest.id} (${manifest.displayName})`);
  return true;
}

/**
 * Get a registered integration by ID.
 *
 * @param {string} integrationId - Integration identifier
 * @returns {RegisteredIntegration|null} Registered integration or null if not found
 */
export function getIntegration(integrationId) {
  return registry.get(integrationId) || null;
}

/**
 * Get all registered integrations.
 *
 * @returns {RegisteredIntegration[]} Array of all registered integrations
 */
export function getAllIntegrations() {
  return [...registry.values()];
}

/**
 * Get all registered integration IDs.
 *
 * @returns {string[]} Array of integration IDs
 */
export function getAllIntegrationIds() {
  return [...registry.keys()];
}

/**
 * Find the integration whose matchDomains include the given hostname.
 *
 * Used during site detection to determine which integration (if any)
 * should be activated for the current page.
 *
 * @param {string} hostname - The hostname to match (e.g., 'my.wealthsimple.com')
 * @returns {RegisteredIntegration|null} Matching integration or null
 */
export function getIntegrationForHostname(hostname) {
  if (!hostname) return null;

  for (const integration of registry.values()) {
    const { matchDomains } = integration.manifest;
    if (matchDomains && matchDomains.some((domain) => hostname.includes(domain))) {
      return integration;
    }
  }

  return null;
}

/**
 * Get all integration manifests.
 *
 * Useful for the settings UI to enumerate available integrations
 * and their capabilities without needing the full registration object.
 *
 * @returns {IntegrationManifest[]} Array of all integration manifests
 */
export function getAllManifests() {
  return [...registry.values()].map((entry) => entry.manifest);
}

/**
 * Get manifest for a specific integration.
 *
 * @param {string} integrationId - Integration identifier
 * @returns {IntegrationManifest|null} Manifest or null if not found
 */
export function getManifest(integrationId) {
  const integration = registry.get(integrationId);
  return integration ? integration.manifest : null;
}

/**
 * Check if an integration is registered.
 *
 * @param {string} integrationId - Integration identifier
 * @returns {boolean} True if registered
 */
export function isRegistered(integrationId) {
  return registry.has(integrationId);
}

/**
 * Get integrations that support a specific capability.
 *
 * @param {string} capability - Capability name (e.g., 'hasTransactions', 'hasHoldings')
 * @returns {RegisteredIntegration[]} Array of integrations with the capability
 */
export function getIntegrationsWithCapability(capability) {
  return [...registry.values()].filter(
    ({ manifest }) => manifest.capabilities && manifest.capabilities[capability],
  );
}

/**
 * Get the total number of registered integrations.
 *
 * @returns {number} Count of registered integrations
 */
export function getIntegrationCount() {
  return registry.size;
}

/**
 * Remove a registered integration.
 *
 * Primarily useful for testing. In production, integrations are
 * registered once at startup and never removed.
 *
 * @param {string} integrationId - Integration identifier to remove
 * @returns {boolean} True if the integration was found and removed
 */
export function unregisterIntegration(integrationId) {
  const existed = registry.has(integrationId);
  if (existed) {
    registry.delete(integrationId);
    debugLog(`[integrationRegistry] Unregistered integration: ${integrationId}`);
  }
  return existed;
}

/**
 * Clear all registered integrations.
 *
 * Only for testing purposes. Should not be called in production.
 */
export function clearRegistry() {
  registry.clear();
  debugLog('[integrationRegistry] Registry cleared');
}

export default {
  registerIntegration,
  getIntegration,
  getAllIntegrations,
  getAllIntegrationIds,
  getIntegrationForHostname,
  getAllManifests,
  getManifest,
  isRegistered,
  getIntegrationsWithCapability,
  getIntegrationCount,
  unregisterIntegration,
  clearRegistry,
};