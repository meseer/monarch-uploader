# ADR-001: Adopt Modular Integration Architecture

> **Status:** Accepted  
> **Date:** 2026-01-10  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

The monarch-uploader codebase grew organically over several integration additions (Questrade, CanadaLife, Rogers Bank, Wealthsimple). Each integration was implemented ad-hoc:

- Repeated patterns with slight variations: auth, storage, and upload logic reinvented per integration
- Configuration scattered across `config.js`, `integrationCapabilities.js`, `accountService.js`, and `configStore.js` simultaneously
- Site detection was a hardcoded `if/else` chain in `src/index.js`
- Difficult onboarding: no single blueprint for adding a new integration
- Tight coupling: integration-specific constants baked into shared services
- No automated way to generate settings UI tabs — each required a custom `render{Institution}Tab()` function

Adding a fifth integration would require touching 8+ shared files and implementing 4+ patterns from scratch with no guidance.

## Decision

We will introduce a **modular integration architecture** with the following properties:

1. **Manifest-driven configuration** — Each integration declares its identity, capabilities, storage keys, and UI settings in a single `manifest.js`. No integration-specific constants in shared files.

2. **Registry-based discovery** — A central `integrationRegistry.js` maps integration IDs to their runtime objects. Site detection, capability queries, and account service lookups all go through the registry.

3. **Factory-pattern APIs** — `createApi(httpClient, storage)` and `createAuth(storage)` receive injected adapters, eliminating direct `GM_*` calls in integration code and enabling Jest testing.

4. **Source/sink separation** — Institution-specific code lives in `source/`; Monarch-specific transformation lives in `sinks/monarch/`. Future sinks (e.g., Actual Budget) add a parallel `sinks/actualbudget/` directory without touching `source/`.

5. **Generic orchestration** — A `syncOrchestrator.js` drives the complete sync workflow via a `SyncHooks` interface. Integrations provide hook implementations; the orchestrator handles CSV formatting, deduplication, balance upload, and reconciliation.

6. **Generic UI** — `src/ui/generic/uiManager.js` replaces per-institution UI managers. Settings tabs are automatically generated from manifests; no manual tab wiring needed.

The architecture is **purely additive** — existing legacy integrations are untouched until there is concrete value in migrating them.

## Consequences

### Positive
- New integrations require no changes to any shared file (registry, capabilities, config, UI)
- Factory-pattern APIs are fully testable in Jest without Tampermonkey globals
- A single runbook ([`docs/runbooks/adding-a-new-integration.md`](../runbooks/adding-a-new-integration.md)) covers the complete process
- Settings tabs appear automatically for all modular integrations
- Source/sink separation makes future sink targets (non-Monarch) straightforward

### Negative / Trade-offs
- Two parallel systems exist during the migration period (legacy static maps + modular registry)
- `integrationCapabilities.js` has a dual-resolution path (`INTEGRATION_CAPABILITIES` map + registry fallback) that is more complex than either alone
- Circular dependency between `integrationCapabilities.js` and `integrationRegistry.js` required a `require()` call inside function bodies (lazy evaluation) rather than a top-level import

### Neutral
- Legacy integrations (Questrade, CanadaLife, Rogers Bank, Wealthsimple) will continue working unchanged until explicitly migrated
- Migration of a legacy integration requires ~9 steps including removing it from all static maps

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Continue ad-hoc pattern | Adds to accumulating technical debt; fifth integration would require the same scattered changes |
| Plugin system with dynamic loading | Over-engineered for a userscript context; introduces security concerns with arbitrary code loading |
| Single-file manifest (all integrations in one file) | Doesn't scale; still requires editing a shared file per new integration |
| Class-based integration pattern | Stateful classes complicate testing and introduce shared-state bugs; factory functions + plain objects are simpler |