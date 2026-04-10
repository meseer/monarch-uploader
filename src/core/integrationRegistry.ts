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
import type {
  IntegrationManifest,
  IntegrationApi,
  IntegrationAuth,
  IntegrationEnrichment,
  IntegrationInjectionPoint,
  IntegrationMonarchMapper,
  SyncHooks,
} from '../integrations/types';

/**
 * Shape of a fully registered integration in the runtime registry.
 */
interface RegisteredIntegration {
  manifest: IntegrationManifest;
  api: IntegrationApi;
  auth: IntegrationAuth;
  enrichment: IntegrationEnrichment | null;
  injectionPoint: IntegrationInjectionPoint;
  monarchMapper: IntegrationMonarchMapper | null;
  syncHooks: SyncHooks | null;
}

/**
 * Internal registry map: integrationId → RegisteredIntegration
 */
const registry = new Map<string, RegisteredIntegration>();

/**
 * Register an integration module in the runtime registry.
 *
 * Should be called during application bootstrap for each integration
 * that is included in the build.
 */
export function registerIntegration({
  manifest,
  api,
  auth,
  enrichment = null,
  injectionPoint,
  monarchMapper = null,
  syncHooks = null,
}: {
  manifest: IntegrationManifest;
  api: IntegrationApi;
  auth: IntegrationAuth;
  enrichment?: IntegrationEnrichment | null;
  injectionPoint: IntegrationInjectionPoint;
  monarchMapper?: IntegrationMonarchMapper | null;
  syncHooks?: SyncHooks | null;
}): boolean {
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
 */
export function getIntegration(integrationId: string): RegisteredIntegration | null {
  return registry.get(integrationId) || null;
}

/**
 * Get all registered integrations.
 */
export function getAllIntegrations(): RegisteredIntegration[] {
  return [...registry.values()];
}

/**
 * Get all registered integration IDs.
 */
export function getAllIntegrationIds(): string[] {
  return [...registry.keys()];
}

/**
 * Find the integration whose matchDomains include the given hostname.
 *
 * Used during site detection to determine which integration (if any)
 * should be activated for the current page.
 */
export function getIntegrationForHostname(hostname: string): RegisteredIntegration | null {
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
 */
export function getAllManifests(): IntegrationManifest[] {
  return [...registry.values()].map((entry) => entry.manifest);
}

/**
 * Get manifest for a specific integration.
 */
export function getManifest(integrationId: string): IntegrationManifest | null {
  const integration = registry.get(integrationId);
  return integration ? integration.manifest : null;
}

/**
 * Check if an integration is registered.
 */
export function isRegistered(integrationId: string): boolean {
  return registry.has(integrationId);
}

/**
 * Get integrations that support a specific capability.
 */
export function getIntegrationsWithCapability(capability: string): RegisteredIntegration[] {
  return [...registry.values()].filter(
    ({ manifest }) => manifest.capabilities && (manifest.capabilities as unknown as Record<string, unknown>)[capability],
  );
}

/**
 * Get the total number of registered integrations.
 */
export function getIntegrationCount(): number {
  return registry.size;
}

/**
 * Remove a registered integration.
 *
 * Primarily useful for testing. In production, integrations are
 * registered once at startup and never removed.
 */
export function unregisterIntegration(integrationId: string): boolean {
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
export function clearRegistry(): void {
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