# ADR-003: Integration Manifest as Single Source of Truth

> **Status:** Accepted  
> **Date:** 2026-01-15  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

In the legacy architecture, integration-specific metadata is scattered across multiple files:

| What | Where |
|------|-------|
| Storage key constants | `src/core/config.js` (`STORAGE.*`) |
| Capability flags (hasTransactions, etc.) | `src/core/integrationCapabilities.js` (`INTEGRATION_CAPABILITIES`) |
| Favicon domain for settings UI | `src/core/integrationCapabilities.js` (`FAVICON_DOMAINS`) |
| Display name | `src/core/integrationCapabilities.js` |
| Default lookback days | `src/services/common/configStore.js` |
| Account list storage key | `src/services/common/accountService.js` |
| Config storage key | `src/services/common/configStore.js` |

Adding or changing anything about an integration requires touching 4–6 different files. There is no single place to look up "everything about integration X".

## Decision

Each modular integration will have a **`manifest.js`** that is the single, authoritative source of truth for all metadata about that integration. The manifest declares:

- **Identity:** `id`, `displayName`, `faviconDomain`
- **Site matching:** `matchDomains`, `matchUrls`
- **Storage:** `storageKeys` (all keys the integration uses, as a named map)
- **Config schema:** what lives in `storageKeys.config`
- **Capabilities:** `capabilities` object with boolean flags
- **Category config:** labels and mapping configuration
- **Per-account settings:** `settings` array with key + default
- **Account creation defaults:** type, subtype
- **Branding:** `brandColor`, `logoCloudinaryId`
- **UI extensions:** feature flags for UI sections

**Rule:** A modular integration MUST NOT add entries to `src/core/config.js`, `INTEGRATION_CAPABILITIES`, `FAVICON_DOMAINS`, or any static service map. All metadata lives in the manifest and is accessed via the registry.

The legacy bridge in `integrationCapabilities.js` provides a `getCapabilities(id)` function that checks the registry first (modular) and falls back to static maps (legacy), so all callsites work uniformly.

## Consequences

### Positive
- New integration = create `src/integrations/{name}/manifest.js` and update no other file
- Complete integration metadata is in one file — easy to read, update, and review
- `getCapabilities(id)` works uniformly for both modular and legacy integrations during migration
- Tests for a modular integration validate only the manifest's own shape — no assertions that the integration appears in static maps (which are the legacy anti-pattern)

### Negative / Trade-offs
- During the migration period, two resolution paths exist: registry (modular) and static maps (legacy). `getCapabilities()` encapsulates this, but the dual-path logic is more complex than a single-source lookup.
- Static maps in `config.js` and `integrationCapabilities.js` are not removed until all integrations are modular — they coexist with the manifest system.
- Circular dependency between `integrationCapabilities.js` (which calls `getManifest()`) and `integrationRegistry.js` (which is populated by `index.js`) required lazy `require()` inside function bodies.

### Neutral
- When all legacy integrations are migrated, the static maps and the dual-resolution logic in `getCapabilities()` can be deleted entirely
- `manifest.js` is a plain JS object (not JSON) to support computed values and comments

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| JSON manifest files | Loses the ability to add comments and computed values; still requires a loader |
| Central registry file (all integrations in one place) | Still requires editing a shared file per new integration; doesn't scale |
| Convention-based discovery (scan filesystem) | Not reliable in a compiled userscript; adds build complexity |
| Keep using static maps, just document them | Doesn't solve the scattered-metadata problem; still requires touching 4–6 files per integration |