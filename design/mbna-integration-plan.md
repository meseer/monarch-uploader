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
| **Logo Cloudinary ID** | TBD |

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

### Account Snapshot (Balance, Credit Limit, Transactions)
```
GET https://service.mbna.ca/waw/mbna/accounts/{accountNumber}/snapshot
Response:
  TBD — contains credit limit, current balance, pending and settled transactions
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

### Milestone 3: Auth + Account Discovery ⏳ Needs API specs

**Goal:** Capture MBNA session from cookies, fetch account info via API.

**Implementation:**
- `auth.js` — implement cookie detection and monitoring
- `api.js` — implement `getAccountInfo()` using `GET /waw/mbna/current-account`
- `api.js` — implement `getAccountSnapshot()` using `GET /waw/mbna/accounts/{accountNumber}/snapshot`
- Wire auth status updates to UI (connection status indicator)

**Tests:**
- `test/integrations/mbna/auth.test.js`
- `test/integrations/mbna/api.test.js`

---

### Milestone 4: Balance + Credit Limit Upload ⏳ Needs API specs

**Goal:** Upload current balance and credit limit to Monarch.

**Implementation:**
- `src/services/mbna-upload.js` — upload orchestrator (balance + credit limit steps)
- Balance reconstruction from transactions (first sync)
- Credit limit sync to Monarch
- Wire upload button to orchestrator

**Tests:**
- `test/services/mbna-upload.test.js` (balance + credit limit)

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

## Design Decisions

1. **Module uses injected adapters only** — `createApi(httpClient, storage)` and `createAuth(storage)` never call `GM_*` directly
2. **API returns raw MBNA data** — no Monarch-specific transformation in `api.js`
3. **Monarch mapper is explicitly coupled** — `monarch-mapper/` directory clearly signals Monarch dependency
4. **Manifest is the single source of truth** — capabilities, settings, storage keys, brand info all in one place
5. **Upload service bridges old and new** — `mbna-upload.js` follows existing patterns (Rogers Bank) but internally uses the module's contract methods
6. **Cookie-based auth** — similar to Wealthsimple's OAuth cookie approach, but simpler (session cookies)
7. **SPA navigation** — MBNA uses Angular-style SPA (`index.html#/accountsoverview`), requires MutationObserver for UI injection