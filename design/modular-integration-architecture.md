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
│   │   ├── index.js                  # Barrel export
│   │   ├── source/                   # Institution-specific, sink-agnostic code
│   │   │   ├── api.js                # API client (GraphQL, token parsing) — NO GM_* calls
│   │   │   ├── auth.js               # Credential/token capture logic
│   │   │   ├── enrichment.js         # Transaction enrichment data fetcher
│   │   │   ├── injectionPoint.js     # Where/how to inject UI on the institution site
│   │   │   └── accountTypes.js       # Account type constants (moved from config.js)
│   │   └── sinks/
│   │       └── monarch/              # Institution-to-Monarch data transformation
│   │           ├── index.js
│   │           ├── transactionRules.js
│   │           ├── transactionRulesHelpers.js
│   │           ├── transactionRulesInvestment.js
│   │           └── creditCardMapper.js
│   │
│   ├── questrade/
│   │   ├── manifest.js
│   │   ├── index.js
│   │   ├── source/
│   │   │   ├── api.js
│   │   │   ├── auth.js
│   │   │   ├── enrichment.js         # Order details fetching
│   │   │   └── injectionPoint.js
│   │   └── sinks/
│   │       └── monarch/
│   │           ├── index.js
│   │           └── transactionRules.js
│   │
│   ├── canadalife/
│   │   ├── manifest.js
│   │   ├── index.js
│   │   ├── source/
│   │   │   ├── api.js
│   │   │   ├── auth.js
│   │   │   └── injectionPoint.js
│   │   └── sinks/
│   │       └── monarch/
│   │           └── index.js           # Simple Buy/Sell mapping
│   │
│   └── rogersbank/
│       ├── manifest.js
│       ├── index.js
│       ├── source/
│       │   ├── api.js
│       │   ├── auth.js               # XHR interception credential capture
│       │   └── injectionPoint.js
│       └── sinks/
│           └── monarch/
│               └── index.js           # Bank category mapping
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

### 3.6 Sink Adapters (`sinks/`)

Each integration contains a `sinks/` directory with per-sink subdirectories for data transformation. The `source/` directory holds institution-specific, sink-agnostic code (API client, auth, balance reconstruction, injection point), while `sinks/{sink-name}/` holds destination-specific transformation logic.

```
{integration}/
├── manifest.js          # Integration metadata (stays at root)
├── index.js             # Barrel export (stays at root)
├── source/              # Institution-specific, sink-agnostic code
│   ├── api.js           # API client
│   ├── auth.js          # Credential/token capture
│   ├── injectionPoint.js
│   └── ...              # Other institution-specific modules
└── sinks/
    └── monarch/         # Monarch-specific data transformation
        ├── index.js
        ├── transactions.js
        ├── balanceFormatter.js
        └── ...
```

When a new sink is added (e.g., Actual Budget), a parallel directory is created:

```
sinks/
├── monarch/             # Existing Monarch transformations
│   └── ...
└── actualbudget/        # New sink transformations
    └── ...
```

Example barrel export from `sinks/monarch/index.js`:

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

## 7. Data-Driven Settings UI

### 7.1 Hybrid Tab Generation (Current State)

The settings modal (`settingsModal.js`) uses a hybrid approach for integration tabs:

- **Hardcoded legacy tabs** — Questrade, CanadaLife, Rogers Bank, Wealthsimple each have a dedicated `render{Integration}Tab()` function and explicit tab entry. These remain until each integration is migrated to the modular architecture.
- **Dynamic modular tabs** — Any integration registered in the `integrationRegistry` that is NOT in the legacy set automatically gets a settings tab. The tab label, favicon, and content are all derived from the integration's manifest and `INTEGRATION_CAPABILITIES`.

```
┌────────────────────────────────────────────────┐
│  Tab List                                       │
│  ─────────                                      │
│  ⚙️ General              (always present)       │
│  🏢 Questrade            (hardcoded legacy)     │
│  🏢 CanadaLife            (hardcoded legacy)     │
│  🏢 Rogers Bank           (hardcoded legacy)     │
│  🏢 Wealthsimple          (hardcoded legacy)     │
│  🏢 MBNA                  (dynamic / modular)   │
│  🏢 [future integration]  (dynamic / modular)   │
│  👑 Monarch               (always present)      │
└────────────────────────────────────────────────┘
```

When a legacy integration is migrated to the module architecture:
1. Remove its entry from the `legacyTabs` array and `legacyIntegrationIds` set in `settingsModal.js`
2. Remove its dedicated `render{Integration}Tab()` function
3. It will then appear automatically via the dynamic modular path

### 7.2 `renderModularIntegrationTab()` — Generic, Capability-Driven

A single function renders the settings tab for any modular integration:

```js
function renderModularIntegrationTab(container, integrationId) {
  const capabilities = getCapabilities(integrationId);

  // 1. Lookback Period (all integrations)
  container.appendChild(createLookbackPeriodSection(integrationId));

  // 2. Account Mappings (all integrations)
  const accounts = accountService.getAccounts(integrationId);
  const mappingsSection = createSection('Account Mappings', '🔗', ...);
  mappingsSection.appendChild(createGenericAccountCards(integrationId, accounts, refreshFn));
  container.appendChild(mappingsSection);

  // 3. Category Mappings (only if hasCategorization)
  if (capabilities.hasCategorization) {
    container.appendChild(renderCategoryMappingsSectionIfEnabled(integrationId, refreshFn));
  }
}
```

### 7.3 Connection Status (Registry-Driven)

For legacy integrations, `checkInstitutionConnection()` uses hardcoded switch/case logic. For modular integrations, it falls through to a generic handler that queries the integration registry:

```js
default: {
  const registration = getIntegration(institutionId);
  if (registration?.auth) {
    return registration.auth.checkStatus().authenticated;
  }
  return false;
}
```

### 7.4 Lookback Period (Generic configStore)

`createLookbackPeriodSection()` and `saveLookbackValue()` work generically for all integrations via `setSetting(integrationId, 'lookbackDays', value)`. Institution display names are resolved from `getDisplayName(integrationId)` — no hardcoded name map required.

### 7.5 End State (After All Migrations)

Once all legacy integrations are migrated to modules:
- `legacyTabs` and `legacyIntegrationIds` are empty — all integration tabs are dynamic
- All `render{Integration}Tab()` functions are deleted
- All switch/case blocks in helpers become unnecessary — the `default` handler covers everything
- `settingsModal.js` becomes ~50% shorter

---

## 8. Generic UI Manager

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

## 9. Execution Plan

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
4. `settingsModal.js` → remove legacy tabs as each integration is migrated (already supports dynamic tabs for modular integrations — see Section 7)
5. `settingsModalHelpers.js` → remove legacy switch/cases once all integrations are modular
6. Clean up old API files
7. `integrations/index.js` barrel with build-time selection
8. Tests, full build validation

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

## 10. Key Design Decisions

1. **Integration module boundary: `source/` vs `sinks/`** — Each integration module uses a `source/` + `sinks/` directory pattern. `source/` contains institution-specific, sink-agnostic code (API clients, auth, balance reconstruction, injection point). `sinks/monarch/` is the ONLY place for sink-coupled code (Monarch-specific transformations). When a new sink is added (e.g., Actual Budget), a parallel `sinks/actualbudget/` directory is created alongside `sinks/monarch/`. The `manifest.js` and `index.js` barrel remain at the integration root. This separation ensures institution logic is reusable across sinks.
2. **Transaction rules = sink adapters** — Institution-to-sink transformations live in `sinks/{sink-name}/`, explicitly scoped to show sink coupling. For Monarch, these live in `sinks/monarch/`.
3. **Merchant mapping stays in core** — Institution-agnostic second-pass normalization applied before Monarch submission
4. **Enrichment in integration modules** — Uses onProgress callback for UI progress reporting without module knowing about UI
5. **Holdings mappings at institution level** — Same security mapping reused across accounts
6. **Generic UI manager** — All institution UIs follow same pattern, config-driven by injectionPoint.js
7. **Build-time selection first** — Lazy loading designed-for but not implemented yet
8. **Complete upload service replacement in Phase 6** — Generic orchestrator fully replaces per-institution services

---

## 11. Sync Hooks & Generic Orchestrator (Part C)

### 11.1 Overview

Part C introduces two generic services (`syncOrchestrator.js`, `pendingReconciliation.js`) and a **SyncHooks** interface that integration modules implement. This separates the universal sync workflow (CSV generation, dedup, upload, balance, credit limit, reconciliation) from institution-specific data access and transformation.

### 11.2 SyncHooks Interface

Each integration provides an object conforming to the `SyncHooks` typedef (defined in `src/integrations/types.js`):

| Hook | Required | Signature | Purpose |
|------|:--------:|-----------|---------|
| `fetchTransactions` | ✅ | `(api, accountId, fromDate, {onProgress}) → {settled, pending, metadata}` | Fetch raw transactions from institution API |
| `processTransactions` | ✅ | `(settled, pending, {includePending}) → {settled, pending}` | Normalize raw transactions (merchant cleanup, amount sign, auto-category) |
| `getSettledRefId` | ✅ | `(tx) → string` | Extract dedup reference ID from a settled transaction |
| `getPendingRefId` | ✅ | `(tx) → string` | Extract dedup reference ID from a pending transaction |
| `resolveCategories` | ✅ | `(transactions, accountId) → Promise<transactions>` | Resolve Monarch categories (stored mappings, similarity, manual prompt) |
| `buildTransactionNotes` | ✅ | `(tx, {storeTransactionDetailsInNotes}) → string` | Build per-row notes for CSV (reference numbers, pending IDs) |
| `getPendingIdFields` | ⬡ | `(rawTx) → Array<string>` | Return stable field values for pending transaction hash ID generation |
| `getSettledAmount` | ⬡ | `(rawSettledTx) → number` | Return Monarch-normalized amount for a raw settled transaction |
| `buildBalanceHistory` | ⬡ | `({currentBalance, metadata, fromDate, invertBalance}) → Array\|null` | Build reconstructed balance history for first-sync |

⬡ = Optional (only needed if integration supports pending transactions or balance reconstruction)

### 11.3 Sync Orchestrator (`services/common/syncOrchestrator.js`)

The orchestrator's `syncAccount()` function drives the complete sync workflow:

```
┌─────────────────────────────────────────────────┐
│  syncAccount(integrationId, manifest, hooks,    │
│              api, account, monarchAccount, ...)  │
├─────────────────────────────────────────────────┤
│                                                  │
│  1. Credit Limit Sync (if hasCreditLimit)        │
│     └── api.getCreditLimit() → creditLimitSync   │
│                                                  │
│  2. Transaction Sync (if hasTransactions)         │
│     ├── hooks.fetchTransactions()                │
│     ├── separateAndDeduplicateTransactions()     │
│     ├── hooks.processTransactions()              │
│     ├── filterDuplicate{Settled,Pending}()       │
│     ├── hooks.resolveCategories()                │
│     ├── convertTransactionsToMonarchCSV()        │
│     │   └── hooks.buildTransactionNotes()        │
│     └── uploadTransactionsAndSaveRefs()          │
│                                                  │
│  3. Pending Reconciliation (if enabled + prefix) │
│     └── reconcilePendingTransactions()           │
│         ├── hooks.getPendingIdFields()           │
│         └── hooks.getSettledAmount()             │
│                                                  │
│  4. Balance Upload                               │
│     ├── hooks.buildBalanceHistory() (first sync) │
│     └── executeBalanceUploadStep()               │
│                                                  │
│  5. Update sync metadata                         │
│     └── accountService.updateAccountInList()     │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**

- **CSV generation is generic.** The orchestrator owns `convertTransactionsToMonarchCSV()` with a fixed column set (`Date`, `Merchant`, `Category`, `Account`, `Original Statement`, `Notes`, `Amount`, `Tags`). The only per-row hook is `buildTransactionNotes`.
- **Filename construction is generic.** Format: `{integrationId}_transactions_{fromDate}_to_{today}.csv`
- **Amount sign** is handled by the institution's `processTransactions` hook (not the orchestrator), because sign convention varies by institution.
- **Progress dialog** is passed in by the caller; the orchestrator calls `initSteps`, `updateStepStatus`, `showSummary`.

### 11.4 Pending Reconciliation (`services/common/pendingReconciliation.js`)

Generic reconciliation engine that works for any integration supporting pending transactions.

**ID Generation:**
- Uses `txIdPrefix` from the integration manifest (e.g., `'mbna-tx'`, `'rb-tx'`)
- Hashes stable field values from `getPendingIdFields(tx)` via SHA-256
- Format: `{prefix}:{first 16 hex chars}` (e.g., `mbna-tx:a1b2c3d4e5f67890`)
- ID is embedded in Monarch transaction notes for later extraction

**Reconciliation Algorithm:**
1. Fetch Monarch transactions tagged "Pending" for the account
2. For each, extract the pending ID from notes via `extractPendingIdFromNotes()`
3. Build hash maps for current source settled + pending transactions
4. Compare:
   - Hash matches settled → **settle** (update amount, remove tag, clean notes)
   - Hash matches still-pending → **skip** (no action)
   - Hash not found → **cancelled** → delete from Monarch

**Exported functions:**

| Function | Purpose |
|----------|---------|
| `generatePendingTransactionId(prefix, fields)` | Deterministic SHA-256 hash ID |
| `extractPendingIdFromNotes(prefix, notes)` | Regex extraction from Monarch notes |
| `cleanPendingIdFromNotes(prefix, notes)` | Remove ID preserving user content |
| `separateAndDeduplicateTransactions({...})` | Split pending/settled, remove duplicates |
| `reconcilePendingTransactions({...})` | Full reconciliation algorithm |
| `formatReconciliationMessage(result)` | Human-readable progress message |

### 11.5 MBNA as First Consumer

MBNA is the first integration wired to the generic orchestrator:

- **`integrations/mbna/sinks/monarch/syncHooks.js`** — Implements all SyncHooks (required + optional)
- **`integrations/mbna/manifest.js`** — Added `txIdPrefix: 'mbna-tx'`
- **`services/mbna-upload.js`** — Reduced from ~400 lines to ~210 lines; `syncMbnaAccount()` creates a progress dialog and calls `syncAccount()` from the orchestrator with MBNA manifest + hooks

### 11.6 Wiring Pattern for New Integrations

To wire an existing or new integration to the generic orchestrator:

1. **Create `sinks/monarch/syncHooks.js`** implementing at minimum the 6 required hooks
2. **Add `txIdPrefix`** to `manifest.js` (if integration supports pending transactions)
3. **Export `syncHooks`** from the integration's `index.js` barrel
4. **Refactor the upload service** to call `syncAccount()` from `syncOrchestrator.js`
5. **Delete** inline sync logic (credit limit, CSV generation, balance, reconciliation) from the upload service

### 11.7 Relationship to Existing Common Services

The orchestrator composes the common services extracted in Part A:

| Common Service | Called By | Purpose |
|----------------|-----------|---------|
| `creditLimitSync.js` | Orchestrator step 1 | Sync credit limit to Monarch |
| `deduplication.js` | Orchestrator step 2 | Filter already-uploaded transactions |
| `transactionUpload.js` | Orchestrator step 2 | Upload CSV + save refs |
| `pendingReconciliation.js` | Orchestrator step 3 | Reconcile pending transactions |
| `balanceUpload.js` | Orchestrator step 4 | Upload balance (single-day or history) |
| `accountService.js` | Orchestrator step 5 | Update sync metadata |
