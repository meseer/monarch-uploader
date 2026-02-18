# MBNA Integration Plan

## Overview

MBNA Canada is the **reference implementation** for the modular integration architecture defined in `design/modular-integration-architecture.md`. This integration strictly follows the standard integration interface contract, serving as the template for migrating existing integrations and adding future ones.

**Integration Type:** Credit card (medium complexity)
**Institution:** MBNA Canada (TD Bank subsidiary)
**Domain:** `service.mbna.ca`
**Architecture Pattern:** `src/integrations/mbna/` following `IntegrationModule` contract

---

## Integration Profile

| Property | Value |
|----------|-------|
| **ID** | `mbna` |
| **Display Name** | `MBNA` |
| **Favicon Domain** | `mbna.ca` |
| **Match Domain** | `service.mbna.ca` |
| **Match URL** | `https://service.mbna.ca/*` |
| **Auth Method** | Cookie-based (session cookies set by MBNA site) |
| **API Style** | HTTP GET with JSON responses |
| **Injection Point** | After `<app-quick-links>` element |
| **Monarch Account Type** | `credit` / `credit_card` |
| **Brand Color** | `#003087` |
| **Logo Cloudinary ID** | `production/account_logos/7f697890-7cb5-4294-9354-faf58db54b69/uyjbhlklztevwjlpmj0n` |

## Capabilities

| Feature | Supported | Notes |
|---------|-----------|-------|
| `hasTransactions` | ✅ | Standard credit card transactions |
| `hasDeduplication` | ✅ | ID-based deduplication |
| `hasBalanceHistory` | ✅ | Balance reconstruction from transactions |
| `hasCreditLimit` | ✅ | Sync credit limit to Monarch |
| `hasHoldings` | ❌ | N/A for credit card |
| `hasBalanceReconstruction` | ✅ | Build balance history from transaction amounts |
| `hasCategorization` | ✅ | Bank category → Monarch category mapping |
| Pending Transactions | ✅ | Hash ID generation + reconciliation |

## Per-Account Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `storeTransactionDetailsInNotes` | `false` | Include transaction details in Monarch notes |
| `transactionRetentionDays` | `91` | Days to retain transaction IDs for dedup |
| `transactionRetentionCount` | `1000` | Max transaction IDs to retain |
| `includePendingTransactions` | `true` | Upload pending transactions |
| `invertBalance` | `false` | Invert balance sign for Monarch |
| `skipCategorization` | `false` | Skip category mapping prompts |

---

## API Endpoints

### Account Info
```
GET https://service.mbna.ca/waw/mbna/current-account
Response:
  .accountNumber          → string (e.g., "00240691635") — required for all subsequent requests
  .cardSummary.endingIn   → string (last 4 digits)
  .cardSummary.cardArtInfo[language="en"].cardName → string (account display name)
```

### Accounts Summary (Multi-Account Discovery)
```
GET https://service.mbna.ca/waw/mbna/accounts/summary
Response: Array of account objects
  [].accountId            → string (e.g., "00240691635")
  [].endingIn             → string (last 4 digits, e.g., "4201")
  [].cardName             → string (e.g., "Amazon.ca Rewards Mastercard®")
  [].cardNameShort        → string (e.g., "Amazon.ca Rewards")
  [].primaryCardHolder    → boolean
  [].pchName              → string (cardholder name)
```

### Account Snapshot (Balance, Credit Limit, Transactions)
```
GET https://service.mbna.ca/waw/mbna/accounts/{accountNumber}/snapshot
Response:
  .accountSnapshotBalances.creditLimit       → number (e.g., 29900.00)
  .accountSnapshotBalances.lastStatementBalance → number
  .accountBalances.currentBalance            → number (e.g., 93.12)
  .accountBalances.creditAvailable           → number (e.g., 29806.88)
  .accountBalances.minimumPaymentDue         → number
  .accountTransactions.pendingTransactions   → array
  .accountTransactions.recentTransactions    → array
```

### Transaction History
```
TBD — detailed endpoint and response format to be provided
```

---

## File Structure

```
src/integrations/mbna/
├── manifest.js               # IntegrationManifest (reference implementation)
├── api.js                    # createApi(httpClient, storage) — HTTP GET JSON client
├── auth.js                   # createAuth(storage) — cookie-based auth monitoring
├── injectionPoint.js         # UI injection config for service.mbna.ca
├── monarch-mapper/
│   ├── index.js              # applyTransactionRule(), pendingTransactions helpers
│   └── pendingTransactions.js # Hash ID generation, separation, reconciliation
└── index.js                  # Barrel export (IntegrationModule shape)
```

### System Wiring Files (modified)

```
src/core/config.js                          # + MBNA storage keys
src/core/integrationCapabilities.js         # + MBNA capabilities entry
src/core/state.js                           # + mbnaAuth state slot
src/services/common/configStore.js          # + MBNA config storage key mapping
src/services/mbna-upload.js                 # Upload orchestrator
src/ui/mbna/uiManager.js                   # UI manager
src/ui/mbna/components/connectionStatus.js  # Connection status component
src/ui/mbna/components/uploadButton.js      # Upload button component
src/index.js                                # + MBNA site detection
src/userscript-metadata.cjs                 # + @match service.mbna.ca
```

**Settings UI — NO changes required.** The settings modal automatically discovers MBNA
via the integration registry. The MBNA tab, favicon, connection status, lookback period,
account mappings, and category mappings sections all appear automatically based on the
manifest and `INTEGRATION_CAPABILITIES` entry. See `design/modular-integration-architecture.md`
Section 7 for the data-driven settings architecture.

### Test Files

```
test/integrations/mbna/manifest.test.js
test/integrations/mbna/api.test.js
test/integrations/mbna/auth.test.js
test/integrations/mbna/monarchMapper.test.js
test/integrations/mbna/pendingTransactions.test.js
test/services/mbna-upload.test.js
```

---

## Milestone Plan

### Milestone 1: Integration Scaffolding + System Wiring ✅ → Testable via unit tests

**Goal:** Create all integration module files following the contract, wire into existing system. No runtime behavior yet — just structure.

**New files:**
- `src/integrations/mbna/manifest.js` — full `IntegrationManifest`
- `src/integrations/mbna/api.js` — `createApi()` skeleton with `getAccountInfo()` only
- `src/integrations/mbna/auth.js` — `createAuth()` skeleton (cookie parsing placeholder)
- `src/integrations/mbna/injectionPoint.js` — injection config
- `src/integrations/mbna/monarch-mapper/index.js` — `applyTransactionRule()` skeleton
- `src/integrations/mbna/monarch-mapper/pendingTransactions.js` — skeleton
- `src/integrations/mbna/index.js` — barrel export
- `src/integrations/index.js` — build-time barrel (new file)

**Modified files:**
- `src/core/config.js` — add `MBNA_CONFIG`, `MBNA_ACCOUNTS_LIST` storage keys
- `src/core/integrationCapabilities.js` — add `MBNA` to `INTEGRATIONS` + `INTEGRATION_CAPABILITIES`
- `src/core/state.js` — add `mbnaAuth` state management
- `src/services/common/configStore.js` — add MBNA to `CONFIG_STORAGE_KEYS`

**Tests:**
- `test/integrations/mbna/manifest.test.js` — validates manifest structure against contract

**Validation:** `npm run lint && npm test && npm run build && npm run build:full`

---

### Milestone 2: UI Injection ✅ → Testable on service.mbna.ca

**Goal:** Inject visible UI on the MBNA website. Upload button calls a placeholder.

**New files:**
- `src/ui/mbna/uiManager.js` — SPA-aware UI injection after `<app-quick-links>`
- `src/ui/mbna/components/connectionStatus.js` — MBNA + Monarch connection status
- `src/ui/mbna/components/uploadButton.js` — upload button (placeholder action)

**Modified files:**
- `src/index.js` — add MBNA site detection + `initializeMbnaApp()`
- `src/userscript-metadata.cjs` — add `@match https://service.mbna.ca/*`

**Validation:** `npm run lint && npm test && npm run build && npm run build:full`

---

### Milestone 3: Auth + Account Discovery ✅

**Goal:** Capture MBNA session from cookies, fetch account info via API.

**Implementation:**
- `auth.js` — HttpOnly cookie auth (no JS-accessible cookies; connectivity determined by API probe)
- `api.js` — `getAccountInfo()` via `GET /waw/mbna/current-account`
- `api.js` — `getAccountsSummary()` via `GET /waw/mbna/accounts/summary`
- `api.js` — `getAccountSnapshot()` via `GET /waw/mbna/accounts/{accountNumber}/snapshot`
- Account selector → Monarch account mapping via `accountSelectorWithCreate`
- Connection probe in `uiManager.js` (API call determines auth state)

**Tests:**
- `test/integrations/mbna/auth.test.js`
- `test/integrations/mbna/api.test.js`

---

### Milestone 4: Credit Limit Sync + Full Sync UI ✅

**Goal:** Sync credit limit to Monarch with full progress dialog UI. Set account icon on newly created Monarch accounts.

**Implementation:**
- `src/services/mbna-upload.js` — upload orchestrator with `syncMbnaAccount()` and `uploadMbnaAccount()`
- Credit limit sync: fetch from snapshot → compare with stored value → push to Monarch → verify
- Progress dialog with 4 steps (creditLimit active; balance, transactions, pending skipped as "Coming soon")
- Account icon upload via `monarchApi.setAccountLogo()` for newly created accounts
- `LOGO_CLOUDINARY_IDS.MBNA` added to `src/core/config.js`
- Fixed `accountService` storage bug: added MBNA to `ACCOUNT_LIST_STORAGE_KEYS`
- UI manager refactored to delegate to upload service

**Tests:**
- `test/services/mbna-upload.test.js` (15 tests: credit limit sync, skipped steps, summary, error handling)
- `test/integrations/mbna/api.test.js` (getCreditLimit + getBalance suites)

---

### Milestone 5: Transaction Sync ⏳ Needs API specs

**Goal:** Download transactions from MBNA, apply category mapping, upload to Monarch.

**Implementation:**
- `api.js` — implement `getTransactions()` 
- `monarch-mapper/index.js` — implement `applyTransactionRule()`
- Upload service — transaction processing pipeline (fetch → categorize → CSV → upload)
- Deduplication using uploaded transaction IDs

**Tests:**
- `test/integrations/mbna/monarchMapper.test.js`
- `test/services/mbna-upload.test.js` (transaction steps)

---

### Milestone 6: Pending Transactions + Reconciliation ⏳ Needs API specs

**Goal:** Handle pending transactions with hash ID generation and reconcile with Monarch.

**Implementation:**
- `monarch-mapper/pendingTransactions.js` — hash ID generation, pending/settled separation
- Upload service — pending transaction flow
- Reconciliation against existing Monarch transactions

**Tests:**
- `test/integrations/mbna/pendingTransactions.test.js`

---

### Milestone 7: Full Tests + Polish

**Goal:** Complete test coverage, build validation, version bump.

**Implementation:**
- Fill any test gaps
- `npm run lint && npm test && npm run build && npm run build:full`
- Version bump: `npm run version:bump -- X.Y.0` (minor: new integration)
- Generate commit message

---

## Settings UI — Automatic via Module Registration

MBNA's settings tab appears **automatically** in the settings modal — no `settingsModal.js`
modifications are needed. This is possible because:

1. **Tab Discovery:** `settingsModal.js` calls `getAllManifests()` from the integration registry
   and generates tabs for any registered module not in the hardcoded legacy set. MBNA's manifest
   provides `displayName` ('MBNA') and `faviconDomain` ('mbna.ca') for the tab button.

2. **Connection Status:** The `checkInstitutionConnection()` default case queries the registry
   for `integration.auth.checkStatus()`. MBNA's `createAuth()` returns `{ authenticated: true }`
   (connectivity determined by API probe, not cookies).

3. **Lookback Period:** `createLookbackPeriodSection()` uses `getDisplayName(integrationId)` for
   the label and `setSetting(integrationId, 'lookbackDays', value)` for persistence — both work
   generically for any integration.

4. **Account Mappings:** `createGenericAccountCards()` already works for any integration via
   `accountService.getAccounts(integrationId)`.

5. **Category Mappings:** The `renderModularIntegrationTab()` function checks `capabilities.hasCategorization`
   and renders the section if enabled. MBNA has `hasCategorization: true`.

**Zero settings code was added or modified for the MBNA integration.**

---

## Design Decisions

1. **Module uses injected adapters only** — `createApi(httpClient, storage)` and `createAuth(storage)` never call `GM_*` directly
2. **API returns raw MBNA data** — no Monarch-specific transformation in `api.js`
3. **Monarch mapper is explicitly coupled** — `monarch-mapper/` directory clearly signals Monarch dependency
4. **Manifest is the single source of truth** — capabilities, settings, storage keys, brand info all in one place
5. **Upload service bridges old and new** — `mbna-upload.js` follows existing patterns (Rogers Bank) but internally uses the module's contract methods
6. **Cookie-based auth** — similar to Wealthsimple's OAuth cookie approach, but simpler (session cookies)
7. **SPA navigation** — MBNA uses Angular-style SPA (`index.html#/accountsoverview`), requires MutationObserver for UI injection