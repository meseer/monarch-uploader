# Adding a New Integration — Step-by-Step Runbook

> **Reference implementation:** All examples use the MBNA integration (`src/integrations/mbna/`).
> All patterns here are derived from working code — not aspirational designs.
>
> **Architecture reference:** See [`design/modular-integration-architecture.md`](../modular-integration-architecture.md) for the "why" behind each pattern.

---

## Overview

Each integration lives entirely in `src/integrations/{name}/` and is registered via the build-time barrel. The rest of the system discovers it through the registry — you do **not** modify any shared service maps or config files.

```
src/integrations/{name}/
├── manifest.js                    # Single source of truth for all metadata
├── index.js                       # Barrel: exports manifest + factories + hooks
├── source/                        # Institution-specific, sink-agnostic
│   ├── api.js                     # API client factory
│   ├── auth.js                    # Auth/session handler factory
│   ├── injectionPoint.js          # UI injection config (selectors, page modes)
│   └── balanceReconstruction.js   # (optional) Balance reconstruction logic
└── sinks/
    └── monarch/                   # Monarch-specific transformation
        ├── index.js               # Barrel re-export
        ├── transactions.js        # Transaction processing + category resolution
        ├── balanceFormatter.js    # (optional) Balance history sign convention
        ├── pendingTransactions.js # (optional) Pending TX dedup utilities
        └── syncHooks.js           # SyncHooks implementation for the orchestrator
```

**The golden rule:** Do NOT add entries to `src/core/config.js`, `src/core/integrationCapabilities.js`, `src/services/common/accountService.js`, or `src/services/common/configStore.js`. All metadata lives in the manifest and is discovered via the registry.

---

## Development approach: incremental milestones

Build the integration in stages. Each stage ends with a concrete, browser-testable validation before adding the next layer of complexity.

| Stage | What you build | What you can validate |
|-------|---------------|----------------------|
| 1 | Manifest + stubs + registration | UI container appears on institution site; settings tab appears |
| 2 | Auth detection | Connection status shows "Connected" |
| 3 | Account discovery | Accounts listed and mappable in settings |
| 4 | Balance sync | Balance uploads to Monarch |
| 5 | Credit limit sync *(credit cards only)* | Credit limit appears in Monarch |
| 6 | Settled transactions | Transactions upload; re-upload does not duplicate |
| 7 | Balance reconstruction *(optional)* | First-sync date picker appears with suggestion; history uploads |
| 8 | Pending transactions *(optional)* | Pending appear tagged; reconcile on next sync |
| 9 | Category mappings *(optional)* | Category mapping UI appears; mapped categories apply |
| 10 | Tests + build validation | All tests pass, build succeeds |

---

## Stage 1 — Manifest + stubs + registration

**Goal:** Get the extension to load on the institution's website and the tab to appear in the settings modal. Nothing needs to work yet — this validates the wiring.

### 1.1 Create the manifest

`src/integrations/{name}/manifest.js` is the **single source of truth** for everything the core needs about this integration.

```js
/** @type {import('../types').IntegrationManifest} */
const manifest = {
  // ── Identity ──────────────────────────────────────────────
  id: 'mybank',            // lowercase, no spaces, used as storage key prefix
  displayName: 'My Bank',  // shown in settings modal tab and UI
  faviconDomain: 'mybank.ca', // domain for Google Favicon API

  // ── Site matching ─────────────────────────────────────────
  // matchDomains is used for site detection (window.location.hostname).
  matchDomains: ['online.mybank.ca'],
  matchUrls: ['https://online.mybank.ca/*'], // informational, not used for runtime matching

  // ── Storage keys ──────────────────────────────────────────
  // Declare ALL storage keys here. Do NOT add them to src/core/config.js.
  storageKeys: {
    accountsList: 'mybank_accounts_list',
    config: 'mybank_config',
    cache: null,
  },

  // ── Default lookback period ───────────────────────────────
  defaultLookbackDays: 30,

  // ── Config schema ─────────────────────────────────────────
  configSchema: {
    auth: ['sessionActive', 'lastChecked'],
    settings: ['lookbackDays'],
    hasCategoryMappings: false,  // set true in Stage 9
    hasHoldingsMappings: false,
  },

  // ── Capabilities ──────────────────────────────────────────
  // Start with everything false. Enable each flag as you implement the feature.
  capabilities: {
    hasTransactions: false,          // enable in Stage 6
    hasDeduplication: false,         // enable in Stage 6
    hasBalanceHistory: true,         // nearly always true
    hasCreditLimit: false,           // enable in Stage 5 (credit cards only)
    hasHoldings: false,
    hasBalanceReconstruction: false, // enable in Stage 7
    hasCategorization: false,        // enable in Stage 9
  },

  // accountKeyName: key under which source account data is stored
  // in the consolidated accounts list entry. Convention: {id}Account
  accountKeyName: 'mybankAccount',
  settings: [
    // Add settings as you implement each stage:
    // { key: 'storeTransactionDetailsInNotes', default: false },   // Stage 6
    // { key: 'transactionRetentionDays', default: 91 },            // Stage 6
    // { key: 'transactionRetentionCount', default: 1000 },         // Stage 6
    // { key: 'invertBalance', default: false },                    // Stage 4/7
    // { key: 'includePendingTransactions', default: true },        // Stage 8
    // { key: 'skipCategorization', default: false },               // Stage 9
  ],

  // Used when auto-creating a Monarch account during first setup.
  // Checking/savings:  defaultType: 'depository', defaultSubtype: 'checking'/'savings'
  // Credit cards:      defaultType: 'credit', defaultSubtype: 'credit_card', accountType: 'credit'
  // Investment:        defaultType: 'investment', defaultSubtype: 'brokerage'
  accountCreateDefaults: {
    defaultType: 'depository',
    defaultSubtype: 'checking',
  },

  brandColor: '#004A97',
  logoCloudinaryId: null,

  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};

export default manifest;
```

**Capability flags decision guide:**

| Flag | Set `true` when... |
|------|-----------------|
| `hasTransactions` | Institution API returns transaction lists |
| `hasDeduplication` | Transactions have a stable unique ID per transaction |
| `hasBalanceHistory` | You can fetch the current account balance (nearly always) |
| `hasCreditLimit` | Credit card account with a credit limit field |
| `hasHoldings` | Investment account with position/holdings data |
| `hasBalanceReconstruction` | Historical statement closing balances are available |
| `hasCategorization` | Institution provides a merchant category field to map |

**`txIdPrefix`** — only add when implementing Stage 8. Format: `'{id}-tx'` (e.g., `'mbna-tx'`).

**`categoryConfig`** — only add when enabling `hasCategorization: true` in Stage 9:
```js
categoryConfig: {
  sourceLabel: 'Bank Category',
},
```

### 1.2 Create the injection point

`src/integrations/{name}/source/injectionPoint.js` tells the generic UI manager where to inject the uploader UI on the institution's page.

```js
/** @type {import('../../types').IntegrationInjectionPoint} */
const injectionPoint = {
  selectors: [], // global fallback; prefer pageModes

  isSPA: true, // true for Angular/React/Vue SPAs (nearly all modern bank sites)

  pageModes: [
    {
      id: 'dashboard',
      urlPattern: /dashboard/,  // regex matched against window.location.href
      uiType: 'all-accounts',   // 'all-accounts' | 'single-account'
      selectors: [
        { selector: '.header-actions', insertMethod: 'insertAfter' },
        { selector: 'header', insertMethod: 'append' }, // fallback
      ],
    },
    {
      id: 'account',
      urlPattern: /account\/details/,
      uiType: 'single-account',
      selectors: [
        { selector: '.account-header', insertMethod: 'insertAfter' },
      ],
    },
  ],

  appPagePatterns: [/dashboard/, /account\//],
  skipPatterns: [/sign-in/, /login/, /sso/, /loading/],

  // DOM ID for the injected UI container — must be globally unique
  containerId: 'monarch-uploader-mybank',
};

export default injectionPoint;
```

**Finding the right selectors:** Open browser DevTools on the institution's site while logged in. Prefer `data-testid` attributes or semantic elements over minified class names. List multiple fallback selectors in priority order — the UI manager tries them top-to-bottom.

**`pageModes`:** Use multiple modes when different pages need different injection targets. `'all-accounts'` shows all mapped accounts; `'single-account'` focuses on the account currently on screen. If the entire site uses one injection point, one mode is sufficient.

### 1.3 Create stub files

**`src/integrations/{name}/source/api.js`:**
```js
export function createApi(_httpClient, _auth) {
  return {};
}
```

**`src/integrations/{name}/source/auth.js`:**
```js
export function createAuth(_storage) {
  return {
    checkStatus() { return { authenticated: false }; },
    getCredentials() { return null; },
  };
}
```

**`src/integrations/{name}/sinks/monarch/syncHooks.js`** — all six required hooks must exist even as stubs:
```js
/** @type {import('../../../types').SyncHooks} */
const syncHooks = {
  async fetchTransactions(_api, _accountId, _fromDate, { onProgress }) {
    onProgress('Fetching...');
    return { settled: [], pending: [], metadata: {} };
  },
  processTransactions(_settled, _pending, _options) {
    return { settled: [], pending: [] };
  },
  getSettledRefId(_tx) { return ''; },
  getPendingRefId(_tx) { return ''; },
  async resolveCategories(transactions, _accountId) { return transactions; },
  buildTransactionNotes(_tx, _options) { return ''; },
};
export default syncHooks;
```

**`src/integrations/{name}/sinks/monarch/index.js`:**
```js
export { default as syncHooks } from './syncHooks';
```

### 1.4 Create the integration barrel

`src/integrations/{name}/index.js`:
```js
import * as monarchMapperNs from './sinks/monarch';

export { default as manifest }       from './manifest';
export { createApi }                 from './source/api';
export { createAuth }                from './source/auth';
export { default as injectionPoint } from './source/injectionPoint';

export const monarchMapper = monarchMapperNs;
export { default as syncHooks }      from './sinks/monarch/syncHooks';
```

### 1.5 Register in the build barrel

Edit `src/integrations/index.js` — add exactly two lines:

```js
import * as mbna from './mbna';
import * as mybank from './mybank';    // ← ADD

const ALL = {
  mbna,
  mybank,                             // ← ADD
};
```

### ✅ Milestone 1 validation

1. Build and install the userscript, then navigate to the institution's website
2. Browser console shows: `[integrationRegistry] Registered integration: mybank (My Bank)`
3. The uploader container appears on the page (empty/"not connected" is expected at this stage)
4. Open the settings modal — a "My Bank" tab appears automatically
5. No console errors about missing modules or failed imports

---

## Stage 2 — Auth detection

**Goal:** When the user is logged in, the connection status indicator shows "Connected."

### Approach A: Probe-based (HttpOnly cookies)

Most modern bank sites use `HttpOnly` session cookies that cannot be read from JavaScript. MBNA uses this approach. `checkStatus()` returns `{ authenticated: true }` unconditionally, and the UI manager uses a real API call as a live connectivity probe — 200 = connected, 401/403 = not connected.

```js
export function createAuth(_storage) {
  return {
    checkStatus() {
      // HttpOnly cookies can't be read from JS.
      // The UI manager probes api.getAccountsSummary() to confirm real auth status.
      return { authenticated: true };
    },
    getCredentials() {
      // GM_xmlhttpRequest automatically forwards HttpOnly cookies
      // for same-origin requests — no manual Cookie header needed.
      return { autoManaged: true };
    },
  };
}
```

`getAccountsSummary()` (implemented in Stage 3) doubles as the auth probe. A 401/403 response triggers the "not connected" state in the UI.

### Approach B: Token interception (readable tokens)

If the institution uses readable tokens in request headers (e.g., `Authorization`, `X-Auth-Token`):

```js
import { getConfig, setConfig } from '../../../services/common/configStore';

const INTEGRATION_ID = 'mybank';

export function createAuth(_storage) {
  function setupMonitoring() {
    const OriginalXHR = unsafeWindow.XMLHttpRequest;

    class InterceptedXHR extends OriginalXHR {
      open(method, url) {
        this._url = url;
        super.open(method, url);
      }

      setRequestHeader(name, value) {
        if (
          this._url?.includes('online.mybank.ca/api') &&
          (name === 'Authorization' || name === 'X-Auth-Token')
        ) {
          this.addEventListener('loadend', async () => {
            if (this.status >= 200 && this.status < 300) {
              const config = getConfig(INTEGRATION_ID);
              await setConfig(INTEGRATION_ID, {
                ...config,
                token: value,
                sessionActive: true,
                lastChecked: new Date().toISOString(),
              });
            }
          });
        }
        super.setRequestHeader(name, value);
      }
    }

    unsafeWindow.XMLHttpRequest = InterceptedXHR;
  }

  return {
    setupMonitoring,
    checkStatus() {
      const config = getConfig(INTEGRATION_ID);
      return { authenticated: !!config?.sessionActive };
    },
    getCredentials() {
      const config = getConfig(INTEGRATION_ID);
      return config?.token ? { token: config.token } : null;
    },
    async clearCredentials() {
      const config = getConfig(INTEGRATION_ID);
      await setConfig(INTEGRATION_ID, { ...config, token: null, sessionActive: false });
    },
  };
}
```

**`setupMonitoring()`** is called automatically by `initGenericUI` at startup. If you use the probe-based approach, omit it entirely.

### ✅ Milestone 2 validation

1. Navigate to the institution's site while already logged in
2. The connection status indicator shows green/connected
3. **Approach A:** check the console for a successful API probe call
4. **Approach B:** navigate to any page that triggers an API call; `GM_getValue('mybank_config')` should show `sessionActive: true`

---

## Stage 3 — Account discovery

**Goal:** The institution's accounts appear in the settings modal and can be mapped to Monarch accounts. Mappings persist across page loads.

### 3.1 Implement account listing in the API

Add `getAccountsSummary()` to `source/api.js`. This also serves as the Approach A auth probe:

```js
export function createApi(httpClient, _auth) {
  async function mybankGet(path) {
    const response = await httpClient.request({
      method: 'GET',
      url: `https://online.mybank.ca/api${path}`,
      headers: { Accept: 'application/json' },
      // GM_xmlhttpRequest forwards cookies (including HttpOnly) automatically
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error('Session expired. Please refresh the page and log in again.');
    }
    if (response.status === 404) {
      throw new Error(`Resource not found: ${path}`);
    }
    if (response.status >= 500) {
      throw new Error('Server error. Please try again later.');
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`API error: HTTP ${response.status}`);
    }
    try {
      return JSON.parse(response.responseText);
    } catch (e) {
      throw new Error(`Failed to parse API response: ${e.message}`);
    }
  }

  return {
    async getAccountsSummary() {
      const data = await mybankGet('/accounts');
      return (data.accounts || []).map((a) => ({
        accountId: a.id,
        displayName: `${a.productName} (${a.last4})`,
        endingIn: a.last4,
        cardName: a.productName,
        raw: a,
      }));
    },
    // Additional methods added in later stages
  };
}
```

### 3.2 Implement `buildAccountEntry` in syncHooks

This optional hook shapes what gets stored under `manifest.accountKeyName` in the accounts list:

```js
buildAccountEntry(account) {
  return {
    id: account.accountId,
    endingIn: account.endingIn,
    cardName: account.cardName,
    nickname: account.displayName,
  };
},
```

These stored fields appear in the settings modal account cards and are available to all sync stages.

### ✅ Milestone 3 validation

1. Open the settings modal → "My Bank" tab
2. Accounts from the institution are listed
3. Map one account to a Monarch account and save
4. Close and reopen settings — the mapping persists
5. `GM_getValue('mybank_accounts_list')` contains an entry with both `mybankAccount` and `monarchAccount` fields set

---

## Stage 4 — Balance sync

**Goal:** Clicking upload fetches the current balance and uploads it to Monarch. The last-sync date updates.

### 4.1 Implement `getBalance()` in the API

```js
async getBalance(accountId) {
  const data = await mybankGet(`/accounts/${accountId}/balance`);
  return {
    currentBalance: data.currentBalance ?? data.availableBalance ?? 0,
    currency: 'CAD',
    raw: data,
  };
},
```

The orchestrator calls `api.getBalance(accountId)` directly when `capabilities.hasBalanceHistory` is `true`. No syncHook is needed for balance upload.

### 4.2 Keep syncHooks stubs in place

At this stage `fetchTransactions` still returns empty arrays. The orchestrator skips the transaction step and proceeds to balance upload:

```js
const syncHooks = {
  async fetchTransactions(_api, _accountId, _fromDate, { onProgress }) {
    onProgress('Preparing...');
    return { settled: [], pending: [], metadata: {} };
  },
  processTransactions(settled, pending, _options) { return { settled, pending }; },
  getSettledRefId(_tx) { return ''; },
  getPendingRefId(_tx) { return ''; },
  async resolveCategories(transactions, _accountId) { return transactions; },
  buildTransactionNotes(_tx, _options) { return ''; },
};
```

Optionally add `{ key: 'invertBalance', default: false }` to `manifest.settings` if users might need to flip the sign.

### ✅ Milestone 4 validation

1. A Monarch account is mapped (Stage 3 done)
2. Click the upload button
3. Progress dialog appears; "Balance upload" completes without error
4. In Monarch, the account's balance updates to the current value
5. The last-sync date in settings updates

---

## Stage 5 — Credit limit sync *(credit cards only)*

**Goal:** The account's credit limit appears in Monarch.

### 5.1 Enable the capability

```js
capabilities: { hasCreditLimit: true },
```

### 5.2 Implement `getCreditLimit()` in the API

```js
async getCreditLimit(accountId) {
  const data = await mybankGet(`/accounts/${accountId}/balance`);
  return data.creditLimit ?? null;
},
```

The orchestrator's Step 1 calls `api.getCreditLimit(accountId)` automatically. No syncHook needed. If this data comes from the same endpoint as balance, consider consolidating into a single snapshot method to avoid duplicate requests (see MBNA's `getAccountSnapshot()`).

### ✅ Milestone 5 validation

1. Run an upload
2. In Monarch, the account shows a credit limit
3. The progress dialog includes "Credit limit sync" as a completed step

---

## Stage 6 — Settled transaction sync

**Goal:** Historical settled transactions upload to Monarch. Re-uploading the same date range does not create duplicates.

### 6.1 Enable capabilities and settings

```js
capabilities: {
  hasTransactions: true,
  hasDeduplication: true,
},
settings: [
  { key: 'storeTransactionDetailsInNotes', default: false },
  { key: 'transactionRetentionDays', default: 91 },
  { key: 'transactionRetentionCount', default: 1000 },
  { key: 'invertBalance', default: false },
],
```

### 6.2 Implement `getTransactions()` in the API

```js
async getTransactions(accountId, startDate, { onProgress } = {}) {
  const data = await mybankGet(
    `/accounts/${accountId}/transactions?from=${startDate}`
  );
  return {
    allSettled: data.transactions || [],
    allPending: [], // pending added in Stage 8
  };
},
```

For paginated endpoints, iterate pages inside this method. For statement-by-statement fetching (like MBNA), accumulate across statements and call `onProgress(current, total, label)` for each statement fetched.

### 6.3 Create `sinks/monarch/transactions.js`

```js
import { applyMerchantMapping } from '../../../../mappers/merchant';
import { applyAutoCategory } from '../../../../mappers/category';

/**
 * Normalize raw MyBank transactions into orchestrator-compatible shape.
 *
 * Required output fields per transaction:
 *   date, merchant, originalStatement, amount, referenceNumber,
 *   isPending, pendingId, autoCategory
 *
 * Amount sign (Monarch convention): charges = negative, payments = positive.
 */
export function processMybankTransactions(settled, pending, options = {}) {
  const { includePending = false } = options;

  function processOne(tx, isPending = false) {
    return {
      date: tx.transactionDate || tx.postedDate || '',
      merchant: applyMerchantMapping(tx.description || ''),
      originalStatement: tx.description || '',
      amount: -(tx.amount || 0), // see sign convention table below
      referenceNumber: tx.referenceNumber || tx.transactionId || '',
      isPending,
      pendingId: null, // populated in Stage 8
      autoCategory: applyAutoCategory(tx.description || ''),
    };
  }

  return {
    settled: settled.map((tx) => processOne(tx, false)),
    pending: includePending ? pending.map((tx) => processOne(tx, true)) : [],
  };
}

export async function resolveMybankCategories(transactions, accountId) {
  const { resolveCategoriesForIntegration } = await import(
    '../../../../services/common/categoryMappingResolver'
  );
  return resolveCategoriesForIntegration('mybank', transactions, accountId);
}
```

**Amount sign convention** — inspect raw API responses in DevTools to determine:

| Institution returns | Code |
|---|---|
| Positive = charge, negative = payment | `amount: -(tx.amount)` |
| Negative = charge, positive = payment | `amount: tx.amount` |
| Absolute value + debit/credit type field | `amount: tx.type === 'DEBIT' ? -(tx.amount) : tx.amount` |

### 6.4 Wire the syncHooks

Replace stubs in `sinks/monarch/syncHooks.js`:

```js
import { processMybankTransactions, resolveMybankCategories } from './transactions';

const syncHooks = {
  async fetchTransactions(api, accountId, fromDate, { onProgress }) {
    onProgress('Fetching transactions...');
    const result = await api.getTransactions(accountId, fromDate, {
      onProgress: (current, total) => onProgress(`Loading statement ${current}/${total}...`),
    });
    return {
      settled: result.allSettled,
      pending: result.allPending,
      metadata: {},
    };
  },

  processTransactions(settled, pending, options) {
    return processMybankTransactions(settled, pending, options);
  },

  getSettledRefId(tx) {
    // Must be stable and unique per transaction across all fetches.
    return tx.referenceNumber;
  },

  getPendingRefId(_tx) {
    return ''; // implemented in Stage 8
  },

  async resolveCategories(transactions, accountId) {
    return resolveMybankCategories(transactions, accountId);
  },

  buildTransactionNotes(tx, { storeTransactionDetailsInNotes = false } = {}) {
    if (storeTransactionDetailsInNotes && !tx.isPending && tx.referenceNumber) {
      return `Ref: ${tx.referenceNumber}`;
    }
    return '';
  },
};

export default syncHooks;
```

**Choosing `getSettledRefId`:** The returned ID is stored in `uploadedTransactions` and compared on every subsequent upload. It must be unique per transaction, stable (same value every fetch), and present in the raw API response. Use the institution's reference number, transaction ID, or confirmation number. If no stable ID exists, set `hasDeduplication: false` in the manifest.

### ✅ Milestone 6 validation

1. Upload with a date range containing known transactions
2. Transactions appear in Monarch with correct amounts, merchants, dates
3. Purchases are **negative**, payments are **positive**
4. Upload the same range again — no duplicates appear
5. "Original Statement" column shows the raw bank description

---

## Stage 7 — Balance reconstruction *(optional)*

**Goal:** On first sync, the date picker suggests the earliest available date, and historical daily balance values upload to populate Monarch's balance history chart.

Skip this stage if the institution does not provide historical statement closing balances.

### 7.1 Enable the capability

```js
capabilities: { hasBalanceReconstruction: true },
```

### 7.2 Create `source/balanceReconstruction.js`

```js
/**
 * Reconstruct daily balance history from statement closing balances.
 *
 * @param {Object} params
 * @param {number} params.currentBalance - Current account balance
 * @param {Array} params.statements - Array of { closingDate: string, statementBalance: number }
 * @param {Array} params.currentCycleSettled - Current cycle settled transactions (used for intra-cycle reconstruction)
 * @param {string} params.startDate - Earliest date to include (YYYY-MM-DD)
 * @returns {Array<{date: string, amount: number}>}
 */
export function buildBalanceHistory({ currentBalance, statements, currentCycleSettled = [], startDate }) {
  const entries = [];

  entries.push({ date: new Date().toISOString().split('T')[0], amount: currentBalance });

  for (const stmt of (statements || [])) {
    if (!stmt.closingDate || stmt.statementBalance == null) continue;
    if (startDate && stmt.closingDate < startDate) continue;
    entries.push({ date: stmt.closingDate, amount: stmt.statementBalance });
  }

  return entries.sort((a, b) => b.date.localeCompare(a.date));
}
```

See `src/integrations/mbna/source/balanceReconstruction.js` for the full MBNA implementation, which handles intra-cycle reconstruction from individual transactions.

### 7.3 Create `sinks/monarch/balanceFormatter.js`

Credit card balances are liabilities — Monarch stores them as negative:

```js
/**
 * Negate balance history for credit card liability convention.
 * For debit/investment accounts, return as-is (no negation needed).
 */
export function formatBalanceHistoryForMonarch(history) {
  return history.map((entry) => ({ date: entry.date, amount: -entry.amount }));
}
```

### 7.4 Implement balance history syncHooks

Add to `sinks/monarch/syncHooks.js`:

```js
import { buildBalanceHistory } from '../../source/balanceReconstruction';
import { formatBalanceHistoryForMonarch } from './balanceFormatter';

// In syncHooks object:
buildBalanceHistory({ currentBalance, metadata, fromDate, invertBalance }) {
  const rawHistory = buildBalanceHistory({
    currentBalance,
    statements: metadata.statements || [],
    currentCycleSettled: metadata.currentCycle?.settled || [],
    startDate: fromDate,
  });

  if (!rawHistory || rawHistory.length === 0) return null;

  // If invertBalance is on, the user wants to flip the sign (asset vs liability).
  return invertBalance ? rawHistory : formatBalanceHistoryForMonarch(rawHistory);
},

async suggestStartDate(api, accountId) {
  try {
    const closingDates = await api.getClosingDates(accountId); // sorted newest first
    if (closingDates.length > 0) {
      const oldest = closingDates[closingDates.length - 1];
      const d = new Date(`${oldest}T00:00:00`);
      d.setDate(d.getDate() - 30);
      const suggestedDate = d.toISOString().split('T')[0];
      return { date: suggestedDate, description: '30 days before oldest statement' };
    }
  } catch (e) {
    // Fall through to default
  }
  return null;
},
```

Also update `fetchTransactions` to return statement data in `metadata`:

```js
async fetchTransactions(api, accountId, fromDate, { onProgress }) {
  onProgress('Fetching transactions...');
  const result = await api.getTransactions(accountId, fromDate, {
    onProgress: (current, total) => onProgress(`Loading statement ${current}/${total}...`),
  });
  return {
    settled: result.allSettled,
    pending: result.allPending,
    metadata: {
      statements: result.statements || [],
      currentCycle: result.currentCycle || null,
    },
  };
},
```

### ✅ Milestone 7 validation

1. Clear stored accounts so the integration treats this as a first sync
2. Click upload — the date picker should appear with a suggested date
3. Accept the suggestion and upload
4. In Monarch, the account's balance history chart should show historical values
5. For credit cards, balances should be negative (liability convention)
6. On subsequent syncs (not first sync), the date picker should show the normal lookback-period default, not the "suggest earliest" dialog

---

## Stage 8 — Pending transaction support *(optional)*

**Goal:** Pending (unposted) transactions upload to Monarch tagged as "Pending". When they settle on the next sync, the pending version is removed and the settled version is uploaded without duplication.

Skip this stage if the institution does not return pending transactions, or if pending transactions lack stable identifying data for hashing.

### 8.1 Update the manifest

```js
// Add txIdPrefix — required for pending transaction ID generation
txIdPrefix: 'mybank-tx',  // ← ADD (format: '{id}-tx')

settings: [
  // ... existing settings ...
  { key: 'includePendingTransactions', default: true },  // ← ADD
],
```

`txIdPrefix` is combined with a SHA-256 hash of stable transaction fields to create a deterministic ID like `mybank-tx:a1b2c3d4e5f67890`. This ID is stored in the Monarch transaction notes and used by the reconciliation service to match pending→settled transitions.

### 8.2 Implement `getPendingIdFields` in syncHooks

This hook returns the ordered field values that get hashed into the pending transaction ID. Choose fields that are:
- **Stable**: the same values every time the pending transaction is fetched
- **Unique enough**: combination distinguishes this pending transaction from others on the same day
- **Available before settlement**: all fields must be present while the transaction is still pending

```js
getPendingIdFields(tx) {
  // Strip any variable suffix from the description for stable hashing.
  // e.g., "Amazon.ca*RA6HH70U3 TORONTO ON" → "Amazon.ca"
  let sanitizedDesc = (tx.description || '').trim();
  const asteriskIdx = sanitizedDesc.indexOf('*');
  if (asteriskIdx > 0) sanitizedDesc = sanitizedDesc.substring(0, asteriskIdx).trim();

  return [
    tx.transactionDate || '',  // date the transaction occurred
    sanitizedDesc,             // sanitized merchant description
    String(tx.amount || 0),    // amount (as string)
    tx.endingIn || '',         // card last 4 (if available, adds uniqueness for multi-card accounts)
  ];
},
```

### 8.3 Implement `getSettledAmount` in syncHooks

Required for pending reconciliation — used to match a settled transaction's amount against what was stored for the pending version:

```js
getSettledAmount(settledTx) {
  // Return the Monarch-normalized amount for a raw settled transaction.
  // Must use the same sign convention as processTransactions.
  const rawAmount = parseFloat(settledTx.amount) || 0;
  return -rawAmount; // negate: institution positive = charge → Monarch negative
},
```

### 8.4 Return pending transactions from the API

Update `getTransactions()` to include pending transactions:

```js
async getTransactions(accountId, startDate, { onProgress } = {}) {
  const [settledData, pendingData] = await Promise.all([
    mybankGet(`/accounts/${accountId}/transactions?from=${startDate}`),
    mybankGet(`/accounts/${accountId}/pending-transactions`),
  ]);
  return {
    allSettled: settledData.transactions || [],
    allPending: pendingData.pendingTransactions || [],
  };
},
```

### 8.5 Generate pending IDs in `processTransactions`

Update `processMybankTransactions` in `transactions.js` to generate pending IDs:

```js
import { generatePendingTransactionId } from './pendingTransactions';

function processOne(tx, isPending = false) {
  const pendingId = isPending
    ? generatePendingTransactionId('mybank-tx', syncHooks.getPendingIdFields(tx))
    : null;

  return {
    date: tx.transactionDate || tx.postedDate || '',
    merchant: applyMerchantMapping(tx.description || ''),
    originalStatement: tx.description || '',
    amount: -(tx.amount || 0),
    referenceNumber: tx.referenceNumber || '',
    isPending,
    pendingId,
    autoCategory: applyAutoCategory(tx.description || ''),
  };
}
```

### 8.6 Update `getPendingRefId` and `buildTransactionNotes`

```js
getPendingRefId(tx) {
  return tx.pendingId;
},

buildTransactionNotes(tx, { storeTransactionDetailsInNotes = false } = {}) {
  const parts = [];
  // Always include pendingId for pending transactions (needed for reconciliation)
  if (tx.isPending && tx.pendingId) {
    parts.push(tx.pendingId);
  }
  if (storeTransactionDetailsInNotes && !tx.isPending && tx.referenceNumber) {
    parts.push(`Ref: ${tx.referenceNumber}`);
  }
  return parts.join('\n');
},
```

### 8.7 Create `sinks/monarch/pendingTransactions.js`

This module provides the `generatePendingTransactionId` utility (the orchestrator's reconciliation service also uses this internally, but you need it available in your sink for `processTransactions`):

```js
import { createHash } from '../../../../../core/utils'; // or use a local SHA-256 impl

/**
 * Generate a deterministic pending transaction ID.
 *
 * @param {string} prefix - Integration prefix (e.g., 'mybank-tx')
 * @param {Array<string>} fields - Ordered field values to hash
 * @returns {string} ID in format 'mybank-tx:a1b2c3d4e5f67890'
 */
export function generatePendingTransactionId(prefix, fields) {
  const input = fields.join('|');
  // SHA-256, first 16 hex chars
  const hash = Array.from(
    new Uint8Array(
      crypto.subtle
        ? new TextEncoder().encode(input)
        : []
    )
  ).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16) || input.slice(0, 16);
  return `${prefix}:${hash}`;
}
```

In practice, re-use the existing `generatePendingTransactionId` from the common reconciliation service rather than reimplementing it. Check how MBNA imports it from the common service in `src/services/common/pendingReconciliation.js`.

### ✅ Milestone 8 validation

1. Navigate to the institution site when there are pending transactions on the account
2. Run an upload — pending transactions appear in Monarch tagged "Pending"
3. Wait for one or more pending transactions to settle (or simulate by checking the next day)
4. Run another upload — the pending transaction should disappear and the settled version should appear
5. No duplicate transactions appear
6. Check that pending transaction notes contain the generated hash ID (e.g., `mybank-tx:a1b2c3d4`)

---

## Stage 9 — Category mappings *(optional)*

**Goal:** A category mapping UI appears in the integration's settings tab. When users map institution categories to Monarch categories, subsequent uploads apply those mappings automatically.

Skip this stage if the institution does not provide per-transaction category data.

### 9.1 Update the manifest

```js
configSchema: {
  hasCategoryMappings: true,  // ← enable
},
capabilities: {
  hasCategorization: true,    // ← enable
},
categoryConfig: {
  sourceLabel: 'Bank Category',  // ← ADD: label shown in mapping UI
},
settings: [
  // ... existing settings ...
  { key: 'skipCategorization', default: false },  // ← ADD
],
```

### 9.2 Include category data in transaction processing

Update `processMybankTransactions` to pass through the institution's category:

```js
function processOne(tx, isPending = false) {
  return {
    // ... existing fields ...
    institutionCategory: tx.category || tx.merchantCategory || null, // raw bank category
    autoCategory: applyAutoCategory(tx.description || ''),
  };
}
```

### 9.3 Use category mappings in `resolveCategories`

The `resolveCategoriesForIntegration` function in the common service handles:
1. Auto-categorized transactions (keep their `autoCategory`)
2. Stored merchant→Monarch mappings (apply from stored config)
3. High-confidence similarity matching (auto-apply)
4. Manual prompts for unresolved merchants (show dialog to user)
5. `skipCategorization` per-account setting (skip dialog if enabled)

Your `resolveCategories` hook already calls this function (set up in Stage 6). The category mapping UI appears automatically in the settings tab once `hasCategorization: true` and `configSchema.hasCategoryMappings: true`.

### ✅ Milestone 9 validation

1. Open the settings modal → "My Bank" tab — a "Category Mappings" section should appear
2. Run an upload with transactions that have institution categories
3. For unrecognized categories, a mapping dialog should appear
4. Map a category to a Monarch category and save
5. Run the upload again — the mapped category is applied automatically without prompting

---

## Stage 10 — Tests and build validation

**Goal:** All tests pass, the build succeeds, and the integration is ready to ship.

### Test file locations

Mirror the source structure in `test/integrations/{name}/`:

```
test/integrations/{name}/
├── manifest.test.js           # Validates manifest shape and required fields
├── api.test.js                # API method unit tests
├── auth.test.js               # Auth handler tests
└── sinks/
    ├── transactions.test.js   # processMybankTransactions, resolveCategories
    ├── syncHooks.test.js      # SyncHooks integration tests
    └── balanceHistory.test.js # Balance reconstruction (if Stage 7)
```

### Manifest tests

Test that the manifest has the correct shape — do **not** assert that the integration appears in `INTEGRATION_CAPABILITIES` or `STORAGE` constants (those are the legacy patterns this architecture eliminates):

```js
import manifest from '../../../src/integrations/mybank/manifest';

describe('mybank manifest', () => {
  it('has required identity fields', () => {
    expect(manifest.id).toBe('mybank');
    expect(manifest.displayName).toBe('My Bank');
    expect(manifest.faviconDomain).toBeDefined();
  });

  it('has valid matchDomains', () => {
    expect(Array.isArray(manifest.matchDomains)).toBe(true);
    expect(manifest.matchDomains.length).toBeGreaterThan(0);
  });

  it('has storageKeys with accountsList and config', () => {
    expect(manifest.storageKeys.accountsList).toBeDefined();
    expect(manifest.storageKeys.config).toBeDefined();
  });

  it('has capabilities object with required boolean flags', () => {
    const required = ['hasTransactions', 'hasDeduplication', 'hasBalanceHistory',
                      'hasCreditLimit', 'hasHoldings', 'hasBalanceReconstruction',
                      'hasCategorization'];
    required.forEach((cap) => {
      expect(typeof manifest.capabilities[cap]).toBe('boolean');
    });
  });

  it('has accountKeyName ending in "Account"', () => {
    expect(manifest.accountKeyName).toMatch(/Account$/);
  });

  it('has settings as array of {key, default} objects', () => {
    manifest.settings.forEach((s) => {
      expect(s.key).toBeDefined();
      expect(s.default !== undefined).toBe(true);
    });
  });

  // If hasCategorization is true:
  if (manifest.capabilities.hasCategorization) {
    it('has categoryConfig.sourceLabel when hasCategorization is true', () => {
      expect(manifest.categoryConfig?.sourceLabel).toBeDefined();
    });
  }

  // If hasDeduplication is true and pending support expected:
  if (manifest.capabilities.hasDeduplication) {
    it('has txIdPrefix when hasDeduplication is true', () => {
      expect(manifest.txIdPrefix).toBeDefined();
    });
  }
});
```

### API tests

```js
import { createApi } from '../../../src/integrations/mybank/source/api';

describe('mybank API', () => {
  let api;
  let mockHttpClient;

  beforeEach(() => {
    mockHttpClient = {
      request: jest.fn(),
    };
    api = createApi(mockHttpClient, null);
  });

  describe('getAccountsSummary', () => {
    it('returns normalized accounts array', async () => {
      mockHttpClient.request.mockResolvedValue({
        status: 200,
        responseText: JSON.stringify({
          accounts: [{ id: 'acc1', productName: 'Chequing', last4: '1234' }],
        }),
      });
      const result = await api.getAccountsSummary();
      expect(result).toHaveLength(1);
      expect(result[0].accountId).toBe('acc1');
      expect(result[0].endingIn).toBe('1234');
    });

    it('throws on 401', async () => {
      mockHttpClient.request.mockResolvedValue({ status: 401, responseText: '' });
      await expect(api.getAccountsSummary()).rejects.toThrow('Session expired');
    });
  });
});
```

### Running the validation sequence

Run the full sequence before marking the integration complete:

```bash
npm run lint && npm test && npm run build && npm run build:full
```

All commands must complete with zero errors. Fix any lint warnings even if the build succeeds.

---

## What you must NOT touch

The following files must remain unchanged when adding a new modular integration. Each has a reason:

| File | Why not to touch |
|------|-----------------|
| `src/core/config.js` | Storage key constants are for legacy integrations only. New integrations declare keys in `manifest.storageKeys`. |
| `src/core/integrationCapabilities.js` | The static `INTEGRATION_CAPABILITIES` map is for legacy integrations. Modular integrations are resolved via `getCapabilities()` → registry fallback. |
| `src/services/common/accountService.js` | `ACCOUNT_LIST_STORAGE_KEYS` is a legacy static map. Modular integrations resolve their key from `manifest.storageKeys.accountsList`. |
| `src/services/common/configStore.js` | `CONFIG_STORAGE_KEYS` is a legacy static map. Modular integrations resolve their config key from `manifest.storageKeys.config`. |
| `src/index.js` | No new `if (siteFlags.isMyBank)` blocks. Modular integrations are detected automatically via `getIntegrationForHostname(window.location.hostname)` using `manifest.matchDomains`. |
| `src/ui/components/settingsModal.js` | No new hardcoded tab entries. Modular integration tabs appear automatically via `getAllManifests()` filtered against the legacy tab set. |

---

## Final checklist

Before calling the integration done, verify every item:

### Files created
- [ ] `src/integrations/{name}/manifest.js`
- [ ] `src/integrations/{name}/index.js`
- [ ] `src/integrations/{name}/source/api.js`
- [ ] `src/integrations/{name}/source/auth.js`
- [ ] `src/integrations/{name}/source/injectionPoint.js`
- [ ] `src/integrations/{name}/sinks/monarch/syncHooks.js`
- [ ] `src/integrations/{name}/sinks/monarch/index.js`
- [ ] `src/integrations/{name}/sinks/monarch/transactions.js` *(Stage 6+)*
- [ ] `src/integrations/{name}/source/balanceReconstruction.js` *(Stage 7 only)*
- [ ] `src/integrations/{name}/sinks/monarch/balanceFormatter.js` *(Stage 7 only)*
- [ ] `src/integrations/{name}/sinks/monarch/pendingTransactions.js` *(Stage 8 only)*

### Registration
- [ ] Added `import * as {name}` and `{name}` entry to `src/integrations/index.js`

### Tests created
- [ ] `test/integrations/{name}/manifest.test.js`
- [ ] `test/integrations/{name}/api.test.js`
- [ ] `test/integrations/{name}/auth.test.js`
- [ ] `test/integrations/{name}/sinks/transactions.test.js` *(Stage 6+)*

### Correctness
- [ ] Amount signs correct: purchases negative, payments positive
- [ ] Deduplication works: re-uploading same range produces no duplicates
- [ ] `getSettledRefId` returns a stable, unique ID for every transaction
- [ ] Manifest has NO entries in `config.js`, `integrationCapabilities.js`, or static service maps
- [ ] Tests do NOT reference `INTEGRATION_CAPABILITIES` or `STORAGE` constants

### Build validation
- [ ] `npm run lint` — zero errors and warnings
- [ ] `npm test` — all tests pass
- [ ] `npm run build` — production build succeeds
- [ ] `npm run build:full` — full build validation passes

### README
- [ ] Add the integration to the **Supported Institutions** table in `README.md`
      - Transactions column: `manifest.capabilities.hasTransactions`
      - Balance History column: `manifest.capabilities.hasBalanceHistory`
      - Holdings column: `manifest.capabilities.hasHoldings`
      - Notes column: account type (credit card, investment, etc.) and any notable constraints
- [ ] Update the **Multi-institution Support** feature bullet to include the new institution name

### Version bump
- [ ] `npm run version:bump -- X.Y.Z` (new integration = minor version bump)
