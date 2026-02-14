# Modular Integration Architecture

## 1. Design Overview

Transform the monolithic userscript into a **core orchestrator + pluggable integration modules** architecture where:

- **Integration modules** are self-contained API libraries for each financial institution (Tampermonkey-agnostic)
- **Core** owns all UI, orchestration, storage, and data-sink logic
- **Data sinks** (Monarch today, Actual Budget / custom backend tomorrow) are pluggable destinations
- **Build-time configuration** selects which integrations to bundle, with the architecture leaving the door open for future lazy-loading / marketplace-style discovery

---

## 2. New Directory Structure

```
src/
├── index.js                          # Entry point: site detection → integration loader
├── scriptInfo.json
├── userscript-metadata.cjs
│
├── core/                             # Core orchestrator
│   ├── config.js                     # Global config (API URLs, UI constants, global storage keys only)
│   ├── state.js                      # Centralized state manager (generic per-integration auth)
│   ├── navigation.js                 # Generic SPA navigation helper
│   ├── utils.js                      # Shared utilities
│   ├── integrationRegistry.js        # Runtime registry of loaded integration modules
│   ├── integrationCapabilities.js    # REFACTORED: auto-generated from module manifests
│   └── storageAdapter.js             # Abstraction over GM_getValue/setValue/etc.
│
├── integrations/                     # One sub-dir per institution
│   ├── index.js                      # Build-time barrel file (imports selected integrations)
│   ├── types.js                      # JSDoc typedefs for the standard integration interface
│   │
│   ├── wealthsimple/
│   │   ├── manifest.js               # Capabilities, metadata, settings, storage keys, match domains
│   │   ├── api.js                    # API client (GraphQL, token parsing) — NO GM_* calls
│   │   ├── auth.js                   # Credential/token capture logic
│   │   ├── enrichment.js             # Transaction enrichment data fetcher
│   │   ├── injectionPoint.js         # Where/how to inject UI on the institution site
│   │   ├── accountTypes.js           # Account type constants (moved from config.js)
│   │   ├── monarch-mapper/           # Institution-to-Monarch data mapper
│   │   │   ├── transactionRules.js
│   │   │   ├── transactionRulesHelpers.js
│   │   │   ├── transactionRulesInvestment.js
│   │   │   ├── creditCardMapper.js
│   │   │   └── index.js
│   │   └── index.js                  # Barrel export
│   │
│   ├── questrade/
│   │   ├── manifest.js
│   │   ├── api.js
│   │   ├── auth.js
│   │   ├── enrichment.js             # Order details fetching
│   │   ├── injectionPoint.js
│   │   ├── monarch-mapper/
│   │   │   ├── transactionRules.js
│   │   │   └── index.js
│   │   └── index.js
│   │
│   ├── canadalife/
│   │   ├── manifest.js
│   │   ├── api.js
│   │   ├── auth.js
│   │   ├── injectionPoint.js
│   │   ├── monarch-mapper/
│   │   │   └── index.js              # Simple Buy/Sell mapping
│   │   └── index.js
│   │
│   └── rogersbank/
│       ├── manifest.js
│       ├── api.js
│       ├── auth.js                   # XHR interception credential capture
│       ├── injectionPoint.js
│       ├── monarch-mapper/
│       │   └── index.js              # Bank category mapping
│       └── index.js
│
├── sinks/                            # Data destination adapters
│   ├── types.js                      # JSDoc typedefs for the data sink interface
│   ├── monarch/
│   │   ├── api.js                    # Merged monarch.js, monarchAccounts.js, monarchTransactions.js
│   │   ├── auth.js                   # Token capture on monarch.com
│   │   └── index.js
│   └── (future: actualbudget/, custom/, etc.)
│
├── services/                         # Business logic / sync orchestration
│   ├── common/
│   │   ├── accountService.js         # Unchanged (uses storageAdapter internally)
│   │   ├── syncOrchestrator.js       # Generic sync workflow engine
│   │   ├── balanceUpload.js          # Extracted common balance upload logic
│   │   ├── transactionUpload.js      # Extracted common transaction upload logic
│   │   ├── holdingsUpload.js         # Extracted common holdings/positions upload logic
│   │   └── deduplication.js          # Extracted common dedup logic
│   └── (thin per-institution adapters for hooks, eventually removed)
│
├── mappers/                          # Institution-agnostic data transformation
│   ├── category.js                   # Category mapping utilities
│   └── merchant.js                   # Merchant name cleanup (second-pass normalization)
│
├── ui/                               # ALL UI stays in core
│   ├── theme.js
│   ├── toast.js
│   ├── keyboardNavigation.js
│   ├── institutionUI.js              # Generic institution UI manager (replaces per-institution uiManagers)
│   ├── components/                   # Settings modal, dialogs, etc.
│   │   ├── settingsModal.js          # REFACTORED: data-driven from integration manifests
│   │   └── ... (existing components)
│   └── (per-institution UI dirs removed after Phase 6)
│
└── utils/                            # General utilities
    ├── csv.js
    └── transactionStorage.js
```

---

## 3. Standard Integration Interface (Contract)

Every integration module exposes the same shape via its `index.js` barrel.

### 3.1 Manifest (`manifest.js`)

```js
/** @type {IntegrationManifest} */
export default {
  // Identity
  id: 'wealthsimple',
  displayName: 'Wealthsimple',
  faviconDomain: 'wealthsimple.com',

  // Site matching
  matchDomains: ['wealthsimple.com'],
  matchUrls: ['https://my.wealthsimple.com/*'],

  // Storage keys
  storageKeys: {
    accountsList: 'wealthsimple_accounts_list',
    config: 'wealthsimple_config',
    cache: 'wealthsimple_cache',
  },

  // Config schema
  configSchema: {
    auth: ['token', 'accessToken', 'identityId', 'tokenExpiresAt'],
    settings: ['lookbackDays'],
    hasCategoryMappings: true,
    hasHoldingsMappings: true,
  },

  // Capabilities (feature flags)
  capabilities: {
    hasTransactions: true,
    hasDeduplication: true,
    hasBalanceHistory: true,
    hasCreditLimit: true,
    hasHoldings: true,
    hasBalanceReconstruction: true,
    hasCategorization: true,
  },

  // Category mapping config
  categoryConfig: {
    sourceLabel: 'Merchant Name',
  },

  // Per-account settings
  accountKeyName: 'wealthsimpleAccount',
  settings: [
    { key: 'storeTransactionDetailsInNotes', default: false },
    { key: 'transactionRetentionDays', default: 91 },
    { key: 'transactionRetentionCount', default: 1000 },
    { key: 'stripStoreNumbers', default: true },
    { key: 'includePendingTransactions', default: true },
    { key: 'skipCategorization', default: false },
  ],

  // Brand theming
  brandColor: 'rgb(50, 48, 47)',
  logoCloudinaryId: 'production/account_logos/...',

  // UI extensions
  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: true,
  },
};
```

### 3.2 API Client (`api.js`)

Tampermonkey-agnostic. Receives injected `httpClient` and `storage` adapters.

```js
/**
 * Create an institution API client
 * @param {HttpClient} httpClient - Injected HTTP client
 * @param {StorageAdapter} storage - Injected storage adapter
 * @returns {InstitutionApi}
 */
export function createApi(httpClient, storage) {
  return {
    async getAccounts() { ... },
    async getBalance(accountId) { ... },
    async getBalanceHistory(accountId, startDate, endDate) { ... },
    async getTransactions(accountId, startDate, endDate) { ... },
    async getPositions(accountId) { ... },
    async getCreditLimit(accountId) { ... },
    // Institution-specific extras
    async getPendingTransactions(accountId) { ... },
  };
}
```

Returns **raw institution data**. Does NOT transform data into Monarch format.

### 3.3 Auth Module (`auth.js`)

```js
/**
 * @param {StorageAdapter} storage - Injected storage adapter
 * @returns {AuthHandler}
 */
export function createAuth(storage) {
  return {
    setupMonitoring() { ... },
    checkStatus() { ... },
    getCredentials() { ... },
    clearCredentials() { ... },
    pollingInterval: 10000,  // null for event-driven
  };
}
```

### 3.4 Enrichment Module (`enrichment.js`)

```js
/**
 * Create enrichment data fetcher for this integration
 * @param {InstitutionApi} api - The integration's API client
 * @returns {EnrichmentFetcher}
 */
export function createEnrichmentFetcher(api) {
  return {
    /**
     * Fetch all enrichment data needed for a set of transactions
     * @param {Array} transactions - Raw transactions
     * @param {Object} options
     * @param {Function} options.onProgress - (stepName, current, total) => void
     * @returns {Promise<Map>} enrichmentMap keyed by transaction ID
     */
    async fetchEnrichmentData(transactions, { onProgress } = {}) { ... }
  };
}
```

### 3.5 Injection Point (`injectionPoint.js`)

```js
export default {
  selectors: [
    { selector: '.kOjAGq', insertMethod: 'prepend' },
    { selector: '.bZQXKE', insertMethod: 'prepend' },
  ],
  isSPA: true,
  pageModes: [
    {
      id: 'dashboard',
      urlPattern: /.*/,
      uiType: 'all-accounts',
    }
  ],
  appPagePatterns: [/\/home/, /\/accounts/],
  skipPatterns: [/\/sign-in/],
  containerId: 'monarch-uploader-wealthsimple',
};
```

### 3.6 Monarch Mapper (`monarch-mapper/`)

Institution-to-Monarch data transformation rules. Explicitly coupled to Monarch's data format.

```js
export { applyTransactionRule } from './transactionRules';
export { processCreditCardTransaction } from './creditCardMapper';
// etc.
```

---

## 4. Core Orchestrator Design

### 4.1 `storageAdapter.js`

```js
export function createGMStorageAdapter() {
  return {
    get(key, defaultValue) { return GM_getValue(key, defaultValue); },
    set(key, value) { GM_setValue(key, value); },
    delete(key) { GM_deleteValue(key); },
    listKeys() { return GM_listValues(); },
  };
}
// Future: createLocalStorageAdapter(), createIndexedDBAdapter()
```

### 4.2 `httpClient.js`

```js
export function createGMHttpClient() {
  return {
    request({ method, url, headers, data, responseType }) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method, url, headers, data, responseType,
          onload: (response) => resolve({ status: response.status, responseText: response.responseText, responseHeaders: response.responseHeaders, response: response.response }),
          onerror: (error) => reject(error),
        });
      });
    },
  };
}
// Future: createFetchHttpClient(), createWebViewHttpClient()
```

### 4.3 `integrationRegistry.js`

```js
const registry = new Map();

export function registerIntegration(manifest, api, auth, enrichment, injectionPoint, monarchMapper) {
  registry.set(manifest.id, { manifest, api, auth, enrichment, injectionPoint, monarchMapper });
}

export function getIntegration(id) { return registry.get(id); }
export function getAllIntegrations() { return [...registry.values()]; }
export function getIntegrationForHostname(hostname) {
  return [...registry.values()].find(
    ({ manifest }) => manifest.matchDomains.some(d => hostname.includes(d))
  );
}
```

### 4.4 `integrations/index.js` — Build-time Barrel

```js
import * as wealthsimple from './wealthsimple';
import * as questrade from './questrade';
import * as canadalife from './canadalife';
import * as rogersbank from './rogersbank';

const ALL = { wealthsimple, questrade, canadalife, rogersbank };
const enabled = typeof __ENABLED_INTEGRATIONS__ !== 'undefined' ? __ENABLED_INTEGRATIONS__ : 'all';

export const AVAILABLE_INTEGRATIONS = enabled === 'all'
  ? Object.values(ALL)
  : enabled.map(id => ALL[id]).filter(Boolean);
```

---

## 5. Storage Consolidation

### Per-Institution Config Store

Replace scattered individual keys with **2-3 top-level keys per institution**:

```
{integration}_accounts_list      # Account data (existing, unchanged)
{integration}_config             # All non-account config (NEW)
{integration}_cache              # Volatile/regenerable data (optional)
```

The `{integration}_config` key stores:

```js
{
  auth: { token, accessToken, identityId, tokenExpiresAt },
  settings: { lookbackDays },
  categoryMappings: { "merchant_name": "Monarch Category" },
  holdingsMappings: {
    "source_security_id": { securityId, holdingId, symbol }
  },
}
```

Holdings mappings move from per-account to institution-level (same security mapping applies across accounts).

---

## 5.1 Storage Migration Status

**Last updated: v5.85.3**

### Current State Summary

All four integrations use consolidated storage (`{integration}_config` + `{integration}_accounts_list`). **No integration dual-writes to legacy keys** — all write paths go exclusively to consolidated/configStore. Rogers Bank is the only integration that still has legacy **read** fallbacks and migration code.

### Migration Completion by Integration

| Integration | configStore | accounts_list | Legacy Keys in config.js | Legacy Read Fallbacks | Migration Code |
|---|:---:|:---:|:---:|:---:|:---:|
| **Wealthsimple** | ✅ | ✅ | ✅ None | ✅ None | ✅ Removed |
| **Questrade** | ✅ | ✅ | ✅ None | ✅ None | ✅ Removed |
| **Canada Life** | ✅ | ✅ | ✅ None | ✅ None | ✅ Removed |
| **Rogers Bank** | ✅ | ✅ | ⏳ 14 legacy keys remain | ⏳ 3 migration paths active | ⏳ Active |

### Rogers Bank — Remaining Legacy Key Inventory

#### Per-Account Prefix Keys (in `config.js`)

Used by `accountService.js` for lazy migrate-on-read and `cleanupLegacyStorage()`:

| Key Constant | Value Pattern | Read By | Migrated By |
|---|---|---|---|
| `ROGERSBANK_ACCOUNT_MAPPING_PREFIX` | `rogersbank_monarch_account_for_{id}` | `accountService.getMonarchAccountMapping()` | `accountService.migrateFromLegacyStorage()` |
| `ROGERSBANK_LAST_UPLOAD_DATE_PREFIX` | `rogersbank_last_upload_date_{id}` | `accountService.migrateFromLegacyStorage()` | `accountService.migrateFromLegacyStorage()` |
| `ROGERSBANK_UPLOADED_REFS_PREFIX` | `rogersbank_uploaded_refs_{id}` | `accountService.getAccounts()` (merge) | `accountService.getAccounts()` (merge) |
| `ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX` | `rogersbank_last_credit_limit_{id}` | `accountService.cleanupLegacyStorage()` | N/A (cleanup only) |
| `ROGERSBANK_BALANCE_CHECKPOINT_PREFIX` | `rogersbank_balance_checkpoint_{id}` | `accountService.cleanupLegacyStorage()` | N/A (cleanup only) |

#### Global Legacy Keys (in `config.js`)

Migrated by both eager and inline lazy paths:

| Key Constant | Value | Read By | Migrated By (Eager) | Migrated By (Inline Lazy) |
|---|---|---|---|---|
| `ROGERSBANK_AUTH_TOKEN` | `rogersbank_auth_token` | — | `legacyMigration.migrateRogersBankAuth()` | `api/rogersbank.getRogersBankCredentials()` |
| `ROGERSBANK_ACCOUNT_ID` | `rogersbank_account_id` | — | `legacyMigration.migrateRogersBankAuth()` | `api/rogersbank.getRogersBankCredentials()` |
| `ROGERSBANK_CUSTOMER_ID` | `rogersbank_customer_id` | — | `legacyMigration.migrateRogersBankAuth()` | `api/rogersbank.getRogersBankCredentials()` |
| `ROGERSBANK_ACCOUNT_ID_ENCODED` | `rogersbank_account_id_encoded` | — | `legacyMigration.migrateRogersBankAuth()` | `api/rogersbank.getRogersBankCredentials()` |
| `ROGERSBANK_CUSTOMER_ID_ENCODED` | `rogersbank_customer_id_encoded` | — | `legacyMigration.migrateRogersBankAuth()` | `api/rogersbank.getRogersBankCredentials()` |
| `ROGERSBANK_DEVICE_ID` | `rogersbank_device_id` | — | `legacyMigration.migrateRogersBankAuth()` | `api/rogersbank.getRogersBankCredentials()` |
| `ROGERSBANK_LAST_UPDATED` | `rogersbank_last_updated` | — | `legacyMigration.migrateRogersBankAuth()` | `api/rogersbank.getRogersBankCredentials()` |
| `ROGERSBANK_LOOKBACK_DAYS` | `rogersbank_lookback_days` | — | `legacyMigration.migrateLookbackDays()` | `utils.getLookbackForInstitution()` |
| `ROGERSBANK_CATEGORY_MAPPINGS` | `rogersbank_category_mappings` | — | `legacyMigration.migrateCategoryMappings()` | `category.getSavedCategoryMappings()` |

### Rogers Bank — Duplicate Migration Paths

Rogers Bank has **three coexisting migration paths** with significant overlap between Path 1 and Path 3:

| Path | Location | Runs When | Migrates | Deletes Legacy Keys |
|---|---|---|---|---|
| **1. Eager** | `legacyMigration.js` | Script load (`index.js`) | Auth (7 keys), lookback, category mappings | ✅ Yes |
| **2. Lazy (accounts)** | `accountService.js` | `getAccounts()` called | Account mappings, upload dates, transaction refs | ❌ No (safety) |
| **3. Inline lazy** | `api/rogersbank.js`, `utils.js`, `category.js` | First read of each data type | Auth (7 keys), lookback, category mappings | ✅ Yes |

**Path 1 and Path 3 fully overlap** — they migrate the exact same 9 global keys (auth, lookback, category mappings). Both are idempotent. The eager path runs at script load; the inline lazy path runs on first read. Cleanup occurs in both.

**Path 2 is distinct** — it handles per-account prefix keys and does NOT delete legacy data (safety rule; cleanup happens via `accountService.cleanupLegacyStorage()` after 2+ successful syncs).

### Admin/Debug Cleanup Utilities

`utils.js` contains admin functions that directly reference Rogers Bank legacy keys for manual cleanup:
- `clearTransactionUploadHistory()` — deletes `ROGERSBANK_UPLOADED_REFS_PREFIX*` keys
- `clearAccountMapping()` — deletes `ROGERSBANK_ACCOUNT_MAPPING_PREFIX*` keys
- `clearLastUploadedDate()` — deletes `ROGERSBANK_LAST_UPLOAD_DATE_PREFIX*` keys
- `clearCategoryMappings()` — deletes both configStore and `ROGERSBANK_CATEGORY_MAPPINGS`

These are developer/debug utilities invoked from the settings modal, not part of the sync flow.

### Next Steps for Rogers Bank

Prioritized order:

1. **Unify eager + inline lazy migration** (eliminate Path 1/Path 3 overlap) — either remove `legacyMigration.js` entirely (rely on inline lazy) or remove inline lazy fallbacks (rely on eager)
2. **Wait for users to sync 2+ times** with consolidated storage (safety threshold for Path 2 cleanup)
3. **Remove per-account prefix keys** from `config.js` (`ROGERSBANK_ACCOUNT_MAPPING_PREFIX`, `ROGERSBANK_LAST_UPLOAD_DATE_PREFIX`, `ROGERSBANK_UPLOADED_REFS_PREFIX`, `ROGERSBANK_LAST_CREDIT_LIMIT_PREFIX`, `ROGERSBANK_BALANCE_CHECKPOINT_PREFIX`)
4. **Remove global legacy keys** from `config.js` (all 9 auth/lookback/category keys)
5. **Remove `LEGACY_*_PREFIXES` maps** from `accountService.js`
6. **Simplify `accountService.cleanupLegacyStorage()`** (remove Rogers Bank-specific keys)
7. **Remove admin cleanup utilities** from `utils.js` (or convert to clear consolidated storage)
8. **Remove `hasLegacyData()`, `migrateFromLegacyStorage()`** and related migration functions

---

## 6. Data Sink Abstraction

```js
/**
 * @typedef {Object} DataSink
 * @property {string} id
 * @property {string} displayName
 * @property {function} checkAuth
 * @property {function} setupTokenCapture
 * @property {function} getAccounts
 * @property {function} createAccount
 * @property {function} uploadBalanceHistory
 * @property {function} updateBalance
 * @property {function} uploadTransactions
 * @property {function} getHoldings
 * @property {function} upsertHolding
 * @property {function} getCategories
 * @property {function} updateCreditLimit
 */
```

---

## 7. Generic UI Manager

All per-institution UI managers (~1,600 lines total) replaced by one generic `institutionUI.js` (~200-300 lines) driven by `injectionPoint.js` config:

```js
export function createInstitutionUIManager(integration, { storage, state, sink }) {
  return {
    async init() {
      // 1. Find injection point from integration.injectionPoint.selectors
      // 2. Detect page mode from integration.injectionPoint.pageModes + current URL
      // 3. Render generic panel (title, status, buttons, settings gear)
      // 4. Set up SPA monitoring if isSPA
      // 5. Set up auth polling if integration.auth.pollingInterval
    },
    renderConnectionStatus(container) { ... },
    renderUploadButton(container, pageMode) { ... },
  };
}
```

---

## 8. Execution Plan

### Phase 0: Foundation (no behavior changes)
1. `src/core/storageAdapter.js` — GM_* abstraction
2. `src/core/httpClient.js` — GM_xmlhttpRequest wrapper
3. `src/core/integrationRegistry.js` — runtime registry
4. `src/integrations/types.js` — integration interface JSDoc types
5. `src/sinks/types.js` — data sink interface types
6. Tests for new modules, full build validation

### Phase 1: Wealthsimple extraction (proof of concept)
1. `integrations/wealthsimple/manifest.js`
2. `integrations/wealthsimple/api.js` — refactor from `src/api/wealthsimple.js`
3. `integrations/wealthsimple/auth.js` — extract token monitoring
4. `integrations/wealthsimple/enrichment.js` — extract enrichment fetching
5. `integrations/wealthsimple/injectionPoint.js` — extract from config.js
6. `integrations/wealthsimple/accountTypes.js` — move from config.js
7. `integrations/wealthsimple/monarch-mapper/` — move transaction rules
8. Register in registry, update service/UI imports
9. Storage consolidation: migrate to `wealthsimple_config`
10. Move holdings mappings to institution-level
11. Tests, full build validation

### Phase 2: Extract remaining integrations
1. Questrade — api, auth, enrichment, monarch-mapper, injection point, manifest
2. Rogers Bank — api, auth (XHR interception), monarch-mapper, injection point, manifest
3. Canada Life — api, auth (Salesforce token), monarch-mapper, injection point, manifest
4. Storage consolidation for each
5. Tests, full build validation

### Phase 3: Core consolidation
1. `integrationCapabilities.js` → derive from registry manifests
2. `config.js` → remove all institution-specific constants
3. `state.js` → generic per-integration auth state
4. `settingsModal.js` → fully data-driven from manifests
5. Clean up old API files
6. `integrations/index.js` barrel with build-time selection
7. Tests, full build validation

### Phase 4: Data sink abstraction
1. `src/sinks/monarch/` — Monarch as first sink
2. Refactor upload services to call sink interface
3. Update accountService for generic sink concept

### Phase 5: Build-time selection
1. Webpack `INTEGRATIONS` env variable support
2. `userscript-metadata.cjs` generates @match from manifests
3. npm scripts: `build:wealthsimple`, `build:questrade`, `build:all`
4. Test subset builds

### Phase 6: Service & UI generalization
1. `src/ui/institutionUI.js` — generic UI manager (replaces 4 per-institution uiManagers)
2. `src/services/common/syncOrchestrator.js` — generic sync workflow
3. Extract common balance, transaction, dedup, holdings logic
4. Convert per-institution upload services to thin adapters, then delete
5. Tests, full build validation

---

## 9. Key Design Decisions

1. **Transaction rules = "monarch-mapper"** — Institution-to-Monarch transformations, shipped in integration module, explicitly named to show Monarch coupling
2. **Merchant mapping stays in core** — Institution-agnostic second-pass normalization applied before Monarch submission
3. **Enrichment in integration modules** — Uses onProgress callback for UI progress reporting without module knowing about UI
4. **Holdings mappings at institution level** — Same security mapping reused across accounts
5. **Generic UI manager** — All institution UIs follow same pattern, config-driven by injectionPoint.js
6. **Build-time selection first** — Lazy loading designed-for but not implemented yet
7. **Complete upload service replacement in Phase 6** — Generic orchestrator fully replaces per-institution services