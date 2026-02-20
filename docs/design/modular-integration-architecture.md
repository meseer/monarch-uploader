# Modular Integration Architecture

## Overview

This document describes the modular integration architecture for monarch-uploader. The architecture was designed incrementally alongside existing legacy integrations (Questrade, CanadaLife, Rogers Bank, Wealthsimple) and has been proven with **MBNA as the reference implementation**.

The MBNA integration is fully operational under this architecture. All patterns documented here are derived from its implementation — not aspirational designs.

---

## Motivation

The legacy codebase grew organically, with each integration added ad-hoc:

- Repeated patterns with slight variations (auth, storage, upload each reinvented)
- Scattered configuration (storage keys defined in `config.js`, `integrationCapabilities.js`, `accountService.js`, `configStore.js` simultaneously)
- Difficult onboarding (no single blueprint for new integrations)
- Tight coupling (integration-specific constants baked into shared services)

The modular architecture addresses this by:

1. **Manifest-driven configuration** — Each integration declares its identity, capabilities, storage keys, and settings in a single `manifest.js`
2. **Registry-based discovery** — Integrations register at startup; the rest of the system discovers them via the registry
3. **Factory-pattern APIs** — `createApi(httpClient, storage)` and `createAuth(storage)` receive injected dependencies — no direct GM_* calls
4. **Separation of source and sink** — Institution-specific API/auth code is in `source/`; Monarch-specific transformation is in `sinks/monarch/`
5. **Generic orchestration** — A `syncOrchestrator` drives the universal sync workflow (dedup, CSV, upload, balance, reconciliation) via a `SyncHooks` interface

---

## Directory Structure

```
src/integrations/
├── index.js           # Build-time barrel + registry bootstrap
├── types.js           # JSDoc typedefs for IntegrationManifest, IntegrationModule, SyncHooks, etc.
└── mbna/              # ← Reference implementation
    ├── manifest.js    # Single source of truth for all MBNA metadata
    ├── index.js       # Barrel export: manifest + factories + syncHooks + mapper
    ├── source/        # Institution-specific, sink-agnostic code
    │   ├── api.js     # API client (GM_xmlhttpRequest via injected httpClient)
    │   ├── auth.js    # Session/cookie monitoring
    │   └── injectionPoint.js  # UI injection config (selectors, pageModes)
    └── sinks/
        └── monarch/   # Monarch-specific transformation
            ├── index.js
            ├── csvFormatter.js
            ├── categoryResolver.js
            ├── balanceHistory.js
            └── syncHooks.js   # SyncHooks implementation for the generic orchestrator
```

As integrations are migrated, each gets its own subdirectory following this same shape.

---

## Key Concepts

### 1. Integration Manifest

`manifest.js` is the **single source of truth** for everything the core needs to know about an integration. No other file should need integration-specific hardcoding.

The MBNA manifest (reference implementation):

```js
const manifest = {
  // ── Identity ─────────────────────────────────────────────────────────
  id: 'mbna',
  displayName: 'MBNA',
  faviconDomain: 'mbna.ca',

  // ── Site matching ─────────────────────────────────────────────────────
  matchDomains: ['service.mbna.ca'],
  matchUrls: ['https://service.mbna.ca/*'],

  // ── Storage ───────────────────────────────────────────────────────────
  storageKeys: {
    accountsList: 'mbna_accounts_list',
    config: 'mbna_config',
    cache: null,                // null = unused
  },

  // ── Config schema ─────────────────────────────────────────────────────
  // Describes what lives in storageKeys.config
  configSchema: {
    auth: ['sessionActive', 'accountNumber', 'lastChecked'],
    settings: ['lookbackDays'],
    hasCategoryMappings: true,
    hasHoldingsMappings: false,
  },

  defaultLookbackDays: 7,

  // ── Pending transaction ID prefix ─────────────────────────────────────
  // Required when hasDeduplication + pending transaction support
  txIdPrefix: 'mbna-tx',

  // ── Capabilities ──────────────────────────────────────────────────────
  capabilities: {
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: true,
    hasHoldings: false,
    hasBalanceReconstruction: true,
    hasCategorization: true,
  },

  // ── Category mapping ──────────────────────────────────────────────────
  categoryConfig: {
    sourceLabel: 'Bank Category',  // Label in the category mapping UI
  },

  // ── Per-account settings ──────────────────────────────────────────────
  accountKeyName: 'mbnaAccount',
  settings: [
    { key: 'storeTransactionDetailsInNotes', default: false },
    { key: 'transactionRetentionDays', default: 91 },
    { key: 'transactionRetentionCount', default: 1000 },
    { key: 'includePendingTransactions', default: true },
    { key: 'invertBalance', default: false },
    { key: 'skipCategorization', default: false },
  ],

  // ── Account creation defaults ─────────────────────────────────────────
  accountCreateDefaults: {
    defaultType: 'credit',
    defaultSubtype: 'credit_card',
    accountType: 'credit',
  },

  // ── Branding ──────────────────────────────────────────────────────────
  brandColor: '#003087',
  logoCloudinaryId: 'production/account_logos/...',

  // ── UI extensions ─────────────────────────────────────────────────────
  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};
```

**Rule:** A new integration MUST NOT add entries to `src/core/config.js`, `INTEGRATION_CAPABILITIES`, or any static service map. All metadata lives in the manifest.

---

### 2. Integration Registry (`src/core/integrationRegistry.js`)

The registry is the runtime map of loaded integrations. It is populated at startup and queried throughout the application lifetime.

#### Registration (from `src/index.js` bootstrap):

```js
import { AVAILABLE_INTEGRATIONS } from './integrations'; // triggers barrel bootstrap
import { registerIntegration } from './core/integrationRegistry';

const httpClient = createGMHttpClient();
const storage = createGMStorageAdapter();

AVAILABLE_INTEGRATIONS.forEach((integration) => {
  registerIntegration({
    manifest:       integration.manifest,
    api:            integration.createApi(httpClient, storage),
    auth:           integration.createAuth(storage),
    injectionPoint: integration.injectionPoint,
    monarchMapper:  integration.monarchMapper || null,
    syncHooks:      integration.syncHooks || null,
    enrichment:     null,   // future
  });
});
```

Note: `registerIntegration` takes a **named-params object**, not positional arguments.

#### Lookup API:

```js
getIntegration(id)                    // → RegisteredIntegration | null
getAllIntegrations()                   // → RegisteredIntegration[]
getAllIntegrationIds()                 // → string[]
getIntegrationForHostname(hostname)   // → RegisteredIntegration | null  (for site detection)
getAllManifests()                      // → IntegrationManifest[]
getManifest(id)                       // → IntegrationManifest | null
isRegistered(id)                      // → boolean
getIntegrationsWithCapability(cap)    // → RegisteredIntegration[]
getIntegrationCount()                 // → number
unregisterIntegration(id)             // → boolean  (testing only)
clearRegistry()                       // (testing only)
```

A `RegisteredIntegration` object has: `{ manifest, api, auth, enrichment, injectionPoint, monarchMapper, syncHooks }`.

---

### 3. Integration Module Shape (`index.js` barrel)

Each integration's `index.js` barrel exports this shape:

```js
export { default as manifest }    from './manifest';
export { createApi }              from './source/api';
export { createAuth }             from './source/auth';
export { default as injectionPoint } from './source/injectionPoint';
export const monarchMapper = monarchMapperNs;  // namespace re-export
export { default as syncHooks }   from './sinks/monarch/syncHooks';
```

The `IntegrationModule` typedef in `src/integrations/types.js` is the authoritative interface contract.

---

### 4. Build-time Barrel (`src/integrations/index.js`)

```js
import * as mbna from './mbna';
// Future: import * as wealthsimple from './wealthsimple';

const ALL = { mbna };

// Webpack DefinePlugin can set __ENABLED_INTEGRATIONS__ to an array of IDs
// to produce a smaller build. Defaults to 'all'.
const enabled = typeof __ENABLED_INTEGRATIONS__ !== 'undefined'
  ? __ENABLED_INTEGRATIONS__
  : 'all';

export const AVAILABLE_INTEGRATIONS = enabled === 'all'
  ? Object.values(ALL)
  : enabled.map((id) => ALL[id]).filter(Boolean);

export default AVAILABLE_INTEGRATIONS;
```

Importing `./integrations` has the side-effect of registering all integrations. **This import must happen before any UI or service code runs.** In `src/index.js` it is the first import.

---

### 5. Factory Pattern for APIs and Auth

Both `createApi` and `createAuth` receive injected adapters — they never call GM_* directly:

```js
// source/api.js
export function createApi(httpClient, storage) {
  return {
    async getTransactions(accountId, fromDate) { ... },
    async getBalance(accountId) { ... },
    async getCreditLimit(accountId) { ... },
  };
}

// source/auth.js
export function createAuth(storage) {
  return {
    setupMonitoring() { ... },
    checkStatus() { ... },
    getCredentials() { ... },
    clearCredentials() { ... },
  };
}
```

This makes integration modules testable without Tampermonkey environment setup.

---

### 6. Source / Sink Separation

```
source/          Institution-specific, sink-agnostic
  api.js         Raw data fetching — returns institution data structures
  auth.js        Credential/session monitoring
  injectionPoint.js  Where/how to inject the UI on the institution site

sinks/monarch/   Monarch-specific transformation
  csvFormatter.js     Institution data → Monarch CSV row
  categoryResolver.js Merchant/bank-category → Monarch category
  balanceHistory.js   Statement data → balance history array
  syncHooks.js        SyncHooks implementation for the orchestrator
```

When a new data sink is added (e.g., Actual Budget), a parallel `sinks/actualbudget/` directory is created. `source/` code is reused unchanged.

---

### 7. `integrationCapabilities.js` — Legacy Bridge

`src/core/integrationCapabilities.js` serves as the bridge between legacy integrations and the modular system.

#### Static map (legacy integrations only):

```
INTEGRATION_CAPABILITIES = {
  questrade:    { ... },
  canadalife:   { ... },
  rogersbank:   { ... },
  wealthsimple: { ... },
  // MBNA intentionally absent — served from manifest
}

FAVICON_DOMAINS = {
  questrade, canadalife, rogersbank, wealthsimple
  // MBNA intentionally absent — served from manifest.faviconDomain
}
```

#### Registry fallback via `getCapabilities(integrationId)`:

```js
export function getCapabilities(integrationId) {
  // 1. Static legacy map
  if (INTEGRATION_CAPABILITIES[integrationId]) {
    return INTEGRATION_CAPABILITIES[integrationId];
  }
  // 2. Modular integration: normalize manifest → legacy-compatible shape
  const { getManifest } = require('./integrationRegistry');  // lazy to avoid circular dep
  const manifest = getManifest(integrationId);
  if (manifest) {
    return buildCapabilitiesFromManifest(manifest);
  }
  return null;
}
```

`buildCapabilitiesFromManifest()` maps manifest fields into the same `IntegrationCapabilities` shape that legacy consumers expect, so all UI code that calls `getCapabilities()` works uniformly for both legacy and modular integrations.

#### Helper functions (all work for both legacy and modular):

| Function | Purpose |
|---|---|
| `getCapabilities(id)` | Full capabilities object |
| `hasCapability(id, cap)` | Boolean check for a single capability |
| `hasSetting(id, key)` | Boolean check for a per-account setting |
| `getSettingDefault(id, key)` | Default value for a setting |
| `getDefaultSettings(id)` | All settings with defaults |
| `getAccountKeyName(id)` | Source account key in consolidated storage |
| `getDisplayName(id)` | Human-readable name |
| `getCategoryMappingsConfig(id)` | `{storageKey, sourceLabel}` or null |
| `getFaviconDomain(id)` | Domain for Google Favicon API (with registry fallback) |
| `getFaviconUrl(id, size)` | Full favicon URL |

**Rule:** All callers should use `getCapabilities()` or these helpers. Never read from `INTEGRATION_CAPABILITIES` directly — that prevents modular integrations from working.

---

### 8. Common Services — Registry Fallback Pattern

`src/services/common/accountService.js` and `configStore.js` contain static maps for legacy integrations. Modular integrations are resolved via registry lookup instead:

```js
// Pattern used in accountService.resolveAccountsListKey()
function resolveAccountsListKey(integrationId) {
  if (ACCOUNT_LIST_STORAGE_KEYS[integrationId]) {
    return ACCOUNT_LIST_STORAGE_KEYS[integrationId];
  }
  const { getManifest } = require('../core/integrationRegistry');
  const manifest = getManifest(integrationId);
  return manifest?.storageKeys?.accountsList ?? null;
}
```

**MBNA is absent from all static maps** in `accountService.js`, `configStore.js`, and `config.js`. Its storage keys come exclusively from the manifest. When adding a new modular integration, do NOT add entries to these static maps.

---

### 9. Site Detection and Bootstrap

`src/index.js` detects modular integrations via the registry after legacy integrations:

```js
// Modular integrations — detected via manifest matchDomains
const modularMatch = getIntegrationForHostname(window.location.hostname);
if (modularMatch) {
  debugLog(`Running on modular integration site: ${modularMatch.manifest.displayName}`);
  initializeModularIntegrationApp(modularMatch.manifest.id);
  initializeMonarchTokenMonitoring();
  return;
}

// Legacy integrations checked after (Wealthsimple, etc.)
```

`initializeModularIntegrationApp(integrationId)` calls `initGenericUI(reg)` from `src/ui/generic/uiManager.js` — a single generic UI manager that replaces per-institution UI managers for modular integrations.

**Note on circular dependency avoidance:** `getIntegrationForHostname` is imported at the top of `index.js`. However, within inner functions that run later, `getIntegration` is called via `require('./core/integrationRegistry')` to prevent circular dependency chains through `integrationCapabilities.js`.

---

## Settings UI — Hybrid Tab Generation

The settings modal uses a hybrid approach during the migration period:

```
┌────────────────────────────────────────────────┐
│  Questrade     ← hardcoded legacy tab          │
│  CanadaLife    ← hardcoded legacy tab          │
│  Rogers Bank   ← hardcoded legacy tab          │
│  Wealthsimple  ← hardcoded legacy tab          │
│  MBNA          ← dynamic modular tab           │
│  [future]      ← dynamic modular tab (auto)    │
└────────────────────────────────────────────────┘
```

Modular integration tabs are automatically generated from `getAllManifests()` filtered against the hardcoded legacy set. No changes to `settingsModal.js` are needed to add a new modular integration — the tab appears automatically once registered.

When a legacy integration is migrated to the modular architecture:
1. Remove its entry from `legacyTabs` and `legacyIntegrationIds` in `settingsModal.js`
2. Remove its `render{Integration}Tab()` function
3. It then appears automatically via the dynamic modular path

---

## SyncHooks Interface and Generic Orchestrator

### Overview

`syncOrchestrator.js` drives the complete sync workflow for any modular integration via a `SyncHooks` contract. The integration provides institution-specific data access; the orchestrator handles all generic logic.

### SyncHooks Interface (from `src/integrations/types.js`)

| Hook | Required | Purpose |
|------|:--------:|---------|
| `fetchTransactions` | ✅ | Fetch raw settled + pending from institution API |
| `processTransactions` | ✅ | Normalize raw transactions (amount sign, merchant, autoCategory) |
| `getSettledRefId` | ✅ | Extract dedup ID from settled transaction |
| `getPendingRefId` | ✅ | Extract dedup ID from pending transaction |
| `resolveCategories` | ✅ | Map transactions to Monarch categories |
| `buildTransactionNotes` | ✅ | Build CSV notes string per transaction |
| `getPendingIdFields` | ⬡ | Stable fields for pending transaction hash (required if pending support) |
| `getSettledAmount` | ⬡ | Amount normalizer for reconciliation |
| `buildBalanceHistory` | ⬡ | Reconstruct balance history for first sync |
| `suggestStartDate` | ⬡ | Suggest default start date for first sync |
| `buildAccountEntry` | ⬡ | Shape the account storage entry |

### Sync Workflow

```
syncAccount(integrationId, manifest, hooks, api, account, monarchAccount, ...)
  │
  ├── 1. Credit limit sync  (if hasCreditLimit)
  ├── 2. Transaction sync   (if hasTransactions)
  │       ├── hooks.fetchTransactions()
  │       ├── separateAndDeduplicateTransactions()
  │       ├── hooks.processTransactions()
  │       ├── filterDuplicate{Settled,Pending}()
  │       ├── hooks.resolveCategories()
  │       ├── convertTransactionsToMonarchCSV()
  │       │     └── hooks.buildTransactionNotes()
  │       └── uploadTransactionsAndSaveRefs()
  ├── 3. Pending reconciliation  (if txIdPrefix + pending enabled)
  │       └── reconcilePendingTransactions()
  │             ├── hooks.getPendingIdFields()
  │             └── hooks.getSettledAmount()
  ├── 4. Balance upload
  │       ├── hooks.buildBalanceHistory()  (first sync)
  │       └── executeBalanceUploadStep()
  └── 5. Update sync metadata
          └── accountService.updateAccountInList()
```

### Pending Transaction ID Generation

The `pendingReconciliation` service generates deterministic IDs for pending transactions:

- Prefix comes from `manifest.txIdPrefix` (e.g., `'mbna-tx'`)
- Fields come from `hooks.getPendingIdFields(rawTx)` — ordered stable values
- Hash: SHA-256 of concatenated fields, first 16 hex chars
- Format: `mbna-tx:a1b2c3d4e5f67890`
- Stored in Monarch transaction notes for later reconciliation extraction

### Wiring a New Integration to the Orchestrator

1. Create `sinks/monarch/syncHooks.js` implementing all required hooks
2. Add `txIdPrefix` to `manifest.js` (if pending transaction support needed)
3. Export `syncHooks` from the integration's `index.js`
4. Write a thin upload service entry point that creates a progress dialog and calls `syncAccount()`
5. The orchestrator handles all generic logic (CSV, dedup, balance, reconciliation)

---

## Storage Conventions

### Per-Integration Storage Keys

Every integration uses this pattern (derived from manifest):

```
{id}_accounts_list   # Consolidated account data + Monarch mappings + sync state
{id}_config          # Auth tokens, global settings, category mappings, holdings mappings
```

Storage keys are declared **only** in `manifest.storageKeys`. They must not appear in `src/core/config.js` or any static service map.

### Account Entry Structure

```js
{
  mbnaAccount: { id, endingIn, cardName, nickname },   // source account (key = manifest.accountKeyName)
  monarchAccount: { id, displayName, ... },             // Monarch account mapping
  syncEnabled: true,
  lastSyncDate: '2024-01-15',
  uploadedTransactions: [{ id: 'mbna-tx:...', date: '2024-01-10' }],
  storeTransactionDetailsInNotes: false,
  transactionRetentionDays: 91,
  transactionRetentionCount: 1000,
  includePendingTransactions: true,
  invertBalance: false,
  skipCategorization: false,
}
```

---

## Adding a New Integration

For a complete step-by-step guide with incremental milestones, validation checkpoints, code examples for every file, and a final checklist, see:

**[`design/integration/adding-a-new-integration.md`](integration/adding-a-new-integration.md)**

That document covers all stages from initial wiring (manifest + stubs) through auth, account discovery, balance sync, transactions, balance reconstruction, pending transactions, category mappings, and test/build validation — in an order that allows testing after each stage.

---

## Migration Path for Legacy Integrations

Questrade, CanadaLife, Rogers Bank, and Wealthsimple continue to work unchanged. The modular architecture is purely additive during the migration period.

When migrating a legacy integration:

1. Create `src/integrations/{name}/manifest.js` — move all metadata out of `INTEGRATION_CAPABILITIES`, `FAVICON_DOMAINS`, `config.js`
2. Create `source/` and `sinks/monarch/` — refactor from `src/api/{name}.js` and `src/services/{name}/`
3. Create `syncHooks.js` — extract institution-specific logic from the upload service
4. Add to `src/integrations/index.js`
5. Remove from `INTEGRATION_CAPABILITIES` and `FAVICON_DOMAINS`
6. Remove `STORAGE.{NAME}_CONFIG` and `STORAGE.{NAME}_ACCOUNTS_LIST` from `config.js`
7. Remove from static maps in `accountService.js` and `configStore.js`
8. Remove from `settingsModal.js` `legacyTabs` / `legacyIntegrationIds`
9. Delete `src/api/{name}.js`, `src/services/{name}-upload.js`, `src/ui/{name}/`

---

## Phase Status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Foundation: storageAdapter, httpClient, integrationRegistry, types | ✅ Complete |
| 1 | MBNA as reference implementation (manifest, source, sinks, syncHooks) | ✅ Complete |
| 2 | Build-time barrel + `__ENABLED_INTEGRATIONS__` webpack support | ✅ Complete |
| 3 | Legacy bridge: `getCapabilities()` registry fallback | ✅ Complete |
| 4 | Generic `syncOrchestrator` + `pendingReconciliation` | ✅ Complete |
| 5 | Generic `institutionUI.js` / `initGenericUI` | ✅ Complete |
| 6 | Data sink abstraction (`src/sinks/`) | 🔲 Future |
| 7 | Extract remaining integrations to modular (Wealthsimple, Questrade, Rogers Bank, CanadaLife) | 🔲 Future |
| 8 | Remove all legacy static maps once all integrations are modular | 🔲 Future |

---

## Storage Consolidation Status

### Per-Integration Storage State

| Integration | `config.js` keys | `INTEGRATION_CAPABILITIES` entry | Static service map entries | Architecture |
|---|:---:|:---:|:---:|:---:|
| **MBNA** | ✅ None | ✅ Absent (manifest-driven) | ✅ None | ✅ Modular |
| **Wealthsimple** | ✅ Consolidated | ✅ Static | ✅ Static | Legacy |
| **Questrade** | ✅ Consolidated | ✅ Static | ✅ Static | Legacy |
| **Canada Life** | ✅ Consolidated | ✅ Static | ✅ Static | Legacy |
| **Rogers Bank** | ⏳ 14 legacy keys remain | ✅ Static | ✅ Static | Legacy |

### Rogers Bank — Remaining Legacy Work

Rogers Bank has 3 coexisting migration paths. Key remaining tasks:

1. Unify eager (`legacyMigration.js`) + inline lazy migration (currently duplicate logic)
2. Once users have 2+ successful syncs with consolidated storage, remove per-account prefix keys
3. Remove global legacy keys from `config.js` (14 keys total)
4. Remove Rogers Bank-specific migration code from `accountService.js`

See Section 5.1 of this document (legacy) for full Rogers Bank key inventory and migration path details.

---

## Design Decisions

1. **Manifest is the source of truth** — Storage keys, capabilities, display names, settings defaults — all come from `manifest.js`. No integration-specific constants scattered in `config.js` or `integrationCapabilities.js`. This was enforced for MBNA by removing its entries from all static maps.

2. **Registry for discovery** — Site detection uses `getIntegrationForHostname(hostname)`. New integrations don't require changes to `src/index.js`. The `matchDomains` array in the manifest drives detection.

3. **Factory pattern for APIs** — `createApi(httpClient, storage)` receives injected adapters. This makes integration modules testable in Jest without any Tampermonkey globals.

4. **`getCapabilities()` as the uniform accessor** — All UI and service code should call `getCapabilities(id)` rather than reading `INTEGRATION_CAPABILITIES[id]` directly. This is the only accessor that handles both legacy and modular integrations uniformly.

5. **Lazy `require()` for circular dependency avoidance** — `integrationCapabilities.js` and `integrationRegistry.js` would form a circular import chain if either imported the other at the module level. The pattern used is `const { getManifest } = require('./integrationRegistry')` inside the function body, evaluated lazily at call time.

6. **Source/Sink separation** — Institution logic is reusable across sinks. Monarch-specific transformation stays in `sinks/monarch/`. When a new sink (e.g., Actual Budget) is added, a parallel `sinks/actualbudget/` directory is created alongside `sinks/monarch/` with no changes to `source/`.

7. **SyncHooks — minimal surface area** — The orchestrator owns all generic logic (CSV format, filename, dedup algorithm, reconciliation algorithm, upload). Hooks provide only institution-specific data access and transformation. This keeps hooks small and testable.

8. **Manifest tests must not reference static maps** — Tests in `test/integrations/{name}/manifest.test.js` validate the manifest's own shape and values. They must not assert that the integration appears in `INTEGRATION_CAPABILITIES` or `STORAGE` — those are the legacy patterns the modular architecture is designed to eliminate.

9. **Progressive migration** — Legacy integrations are untouched until there is a concrete benefit to migrating. The dual-resolution pattern in `getCapabilities()` and common services ensures zero-disruption coexistence.