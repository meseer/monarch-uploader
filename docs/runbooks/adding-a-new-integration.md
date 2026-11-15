# Adding a New Integration — Step-by-Step Runbook

> **Status:** Active  
> **Updated:** 2026-11-14  
> **Author:** @meseer  

> **Reference implementations:** See `src/integrations/mbna/`, `src/integrations/pcfinancial/`, and `src/integrations/neo/`.
> All patterns here are derived from working code — not aspirational designs.
>
> **Architecture reference:** See [`design/modular-integration-architecture.md`](../design/modular-integration-architecture.md) for the "why" behind each pattern.
>
> **Credentials are never stored** ([ADR-010](../decisions/010-credentials-are-never-stored.md)). Stage 2 shows the allowed ways to get them.

---

## Overview

Each integration lives entirely in `src/integrations/{name}/` and is registered via the build-time barrel (`src/integrations/index.ts`) and userscript metadata (`src/userscript-metadata.cjs`). The rest of the system discovers it through the registry — you do **not** modify any shared service maps or config files.

```
src/integrations/{name}/
├── manifest.ts                    # Single source of truth for all metadata
├── index.ts                       # Barrel: exports manifest + factories + hooks
├── source/                        # Institution-specific, sink-agnostic
│   ├── api.ts                     # API client factory
│   ├── auth.ts                    # Auth/session handler factory
│   ├── injectionPoint.ts          # UI injection config (selectors, page modes, containerStyle)
│   └── balanceReconstruction.ts   # (optional) Balance reconstruction logic
└── sinks/
    └── monarch/                   # Monarch-specific transformation
        ├── index.ts               # Barrel re-export
        ├── transactions.ts        # Transaction processing + category resolution
        ├── balanceFormatter.ts    # (optional) Balance history sign convention
        ├── pendingTransactions.ts # (optional) Pending TX dedup utilities
        └── syncHooks.ts           # SyncHooks implementation for the orchestrator
```

**The golden rule:** Do NOT add entries to `src/core/config.ts`, `src/core/integrationCapabilities.ts`, `src/services/common/accountService.ts`, or `src/services/common/configStore.ts`. All metadata lives in the manifest and is discovered via the registry.

---

## Development approach: incremental milestones

Build the integration in stages. Each stage ends with a concrete, browser-testable validation before adding the next layer of complexity.

| Stage | What you build | What you can validate |
|-------|---------------|----------------------|
| 0 | API & page discovery | Auth mechanism, minimal headers, and deterministic API endpoints identified |
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

## Stage 0 — API & page discovery

**Goal:** Before writing code, identify how the institution's web app authenticates, which backend API endpoints return account and transaction data, and where the uploader card belongs on the page.

### 0.1 Prefer deterministic backend APIs over DOM scraping

Modern banking web apps are SPAs backed by JSON or GraphQL APIs. **Always query the backend API endpoints directly** to discover accounts, balances, credit limits, account open dates, and transactions:

- **Do NOT scrape the DOM** (e.g., querying `h1` for account names or regex-matching `$1,234.56` in `document.body.innerText`) or rely on passively intercepting page navigation traffic to discover accounts when an API endpoint exists. DOM scraping is fragile and strictly a last resort when no backend endpoint exists.
- Open browser DevTools → **Network** tab (Filter: `Fetch/XHR`) while logging in and navigating the dashboard and account views. Look for endpoints returning:
  1. Account list / configuration (product types, account IDs, nicknames)
  2. Card list (masked card numbers / last 4 digits, cardholder info)
  3. Account details / summary (current balance, credit limit, `dateOpened`)
  4. Posted and pending/authorized transactions (pagination parameters, date fields, unique IDs, debit/credit sign convention)

### 0.2 Determine the auth mechanism (simplest first)

Check how API requests are authenticated in this order (see [Stage 2](#stage-2--auth-detection) and [ADR-010](../decisions/010-credentials-are-never-stored.md)):

1. **HttpOnly cookies (Approach A):** If the request has no `Authorization` or custom token headers (or uses only cookies sent automatically by the browser), no token extraction is needed.
2. **Page storage or readable cookies (Approach B):** If the request includes a bearer token, CSRF token, or correlation ID header, inspect DevTools → **Application** → `Session Storage`, `Local Storage`, and `Cookies`. Often the SPA stores a JSON object in `sessionStorage` or `localStorage` containing the access token and CSRF token (e.g., PC Financial's `CREDENTIALS` and `UVCRLID` keys in `sessionStorage`). Reading these on demand requires zero network hooks and works immediately on page load.
3. **In-memory request capture (Approach C):** Only intercept `unsafeWindow.fetch` / `XMLHttpRequest` if the required auth header is nowhere in cookies or Web Storage.

### 0.3 Minimize request headers by elimination

Banking SPAs often attach 15–30 custom headers to every request (analytics IDs, device fingerprints, marketing group IDs, trace IDs). Do not blindly copy or intercept all of them:

1. Copy a working API request from DevTools as `curl`.
2. Strip suspect headers (`fingerprint`, `mcid`, `groupid`, `origin`, `referer`, analytics headers) one by one or in batches and replay the request.
3. Keep only the headers that the backend actually validates (plus standard correlation/trace UUIDs that you can generate via `crypto.randomUUID()`).
4. If the backend validates a per-request nonce or timestamp header and occasionally returns a transient verification error (e.g., `HTTP 400 invalid_verifier`), implement a small retry loop (2–3 attempts) that regenerates a fresh nonce per attempt.

### 0.4 Inspect the dashboard DOM for the injection point

While in DevTools → **Elements**, locate a stable container on the dashboard where the uploader card fits naturally (e.g., right after a quick-actions bar or sidebar summary). Copy the computed CSS rules (`background`, `border`, `border-radius`, `box-shadow`, `padding`) of adjacent cards on the page so you can match the native look via `containerStyle` in `injectionPoint.ts`.

---

## Stage 1 — Manifest + stubs + registration

**Goal:** Get the extension to load on the institution's website and the tab to appear in the settings modal. Nothing needs to work yet — this validates the wiring.

### 1.1 Create the manifest

`src/integrations/{name}/manifest.ts` is the **single source of truth** for everything the core needs about this integration.

```ts
import type { IntegrationAccountDefaults, IntegrationManifest } from '../types';

const CREDIT_DEFAULTS: IntegrationAccountDefaults = {
  defaultType: 'credit',
  defaultSubtype: 'credit_card',
  accountType: 'credit',
  invertBalance: false,
};

const DEPOSITORY_DEFAULTS: IntegrationAccountDefaults = {
  defaultType: 'depository',
  defaultSubtype: 'checking',
  accountType: 'depository',
  invertBalance: true,
};

const manifest: IntegrationManifest = {
  // ── Identity ──────────────────────────────────────────────
  id: 'mybank',            // lowercase, no spaces, used as storage key prefix
  displayName: 'My Bank',  // shown in settings modal tab and UI
  faviconDomain: 'mybank.ca', // domain for Google Favicon API

  // ── Site matching ─────────────────────────────────────────
  // matchDomains is used for site detection (window.location.hostname).
  matchDomains: ['online.mybank.ca'],
  matchUrls: ['https://online.mybank.ca/*'], // informational, also add to src/userscript-metadata.cjs

  // ── Storage keys ──────────────────────────────────────────
  // Declare ALL storage keys here. Do NOT add them to src/core/config.ts.
  storageKeys: {
    accountsList: 'mybank_accounts_list',
    config: 'mybank_config',
    cache: null,
  },

  // ── Default lookback period ───────────────────────────────
  defaultLookbackDays: 30,

  // ── Config schema ─────────────────────────────────────────
  configSchema: {
    auth: [],  // non-secret session status only, never credentials (ADR-010)
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
  accountCreateDefaults: CREDIT_DEFAULTS,

  // Optional: when an institution offers multiple account types (e.g. both
  // checking/depository and credit card accounts), resolve defaults per account:
  accountDefaultsForAccount(account: Record<string, any> | null | undefined): IntegrationAccountDefaults {
    const type = String(account?.type || account?.raw?.type || '').toUpperCase();
    if (type === 'CHECKING' || type === 'DEPOSITORY') {
      return DEPOSITORY_DEFAULTS;
    }
    return CREDIT_DEFAULTS;
  },

  brandColor: '#333333',
  logoCloudinaryId: null, // see note below on capturing the Cloudinary logo ID

  uiExtensions: {
    showTokenExpiry: false,
    showTestingSection: false,
  },
};

export default manifest;
```

**Multi-account-type institutions (`accountDefaultsForAccount`):** If an institution supports only one account type (e.g., credit cards only), `accountCreateDefaults` alone is sufficient. If it supports both depository and credit card accounts (like PC Financial or Neo Financial), implement `accountDefaultsForAccount(account)` so new Monarch accounts get the right type/subtype and per-account `invertBalance` default automatically.

**Setting `logoCloudinaryId` and `brandColor`:**
- `brandColor` sets the header background color of the injected uploader card. Pick a dark or brand-appropriate hex color that contrasts well with white text and blends with the institution's dashboard.
- `logoCloudinaryId` applies an account icon in Monarch when the user creates a new Monarch account during first sync. To obtain one: upload the institution's logo to an account in Monarch Money while watching DevTools → Network (`graphql`), inspect the `Common_SetAccountLogo` mutation payload, and copy `variables.input.cloudinaryPublicId` (e.g., `'production/account_logos/.../...'`).

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
```ts
categoryConfig: {
  sourceLabel: 'Bank Category',
},
```

### 1.2 Create the injection point

`src/integrations/{name}/source/injectionPoint.ts` tells the generic UI manager where to inject the uploader UI on the institution's page and how to style the card wrapper.

```ts
import type { IntegrationInjectionPoint } from '../../types';

const injectionPoint: IntegrationInjectionPoint = {
  selectors: [], // global fallback; prefer pageModes

  isSPA: true, // true for Angular/React/Vue SPAs (nearly all modern bank sites)

  pageModes: [
    {
      id: 'dashboard',
      urlPattern: /dashboard/,  // regex matched against window.location.href
      uiType: 'all-accounts',   // 'all-accounts' | 'single-account'
      selectors: [
        { selector: '.quick-actions-container', insertMethod: 'insertAfter' },
        { selector: 'header', insertMethod: 'append' }, // fallback
      ],
    },
  ],

  appPagePatterns: [/dashboard/, /account\//],
  skipPatterns: [/sign-in/, /login/, /sso/, /loading/],

  // DOM ID for the injected UI container — must be globally unique
  containerId: 'monarch-uploader-mybank',

  // Optional: override outer card styles to match the institution's native cards
  containerStyle: {
    borderRadius: '12px',
    border: '1px solid rgba(0, 0, 0, 0.1)',
    boxShadow: 'none',
    padding: '12px',
  },
};

export default injectionPoint;
```

**Finding the right selectors:** Open browser DevTools on the institution's site while logged in. Prefer `data-testid` attributes or semantic elements over framework-generated attributes (such as Angular's `[_ngcontent-...]`). List multiple fallback selectors in priority order — the UI manager tries them top-to-bottom.

**Matching native card styling (`containerStyle`):** Use `containerStyle` to override the default white box (`borderRadius`, `border`, `background`, `boxShadow`, `padding`) so the injected card matches adjacent widgets on the page.

**`pageModes`:** Use multiple modes when different pages need different injection targets. `'all-accounts'` shows all mapped accounts; `'single-account'` focuses on the account currently on screen. If the entire site uses one injection point, one mode is sufficient.

### 1.3 Create stub files

**`src/integrations/{name}/source/api.ts`:**
```ts
import type { HttpClient, IntegrationApi, IntegrationAuth } from '../../types';

export function createApi(_httpClient: HttpClient, _auth: IntegrationAuth | null): IntegrationApi {
  return {};
}
```

**`src/integrations/{name}/source/auth.ts`:**
```ts
import type { IntegrationAuth, StorageAdapter } from '../../types';

export function createAuth(_storage?: StorageAdapter): IntegrationAuth {
  return {
    checkStatus() { return { authenticated: false }; },
    getCredentials() { return null; },
  };
}
```

**`src/integrations/{name}/sinks/monarch/syncHooks.ts`** — all six required hooks must exist even as stubs:
```ts
import type { SyncHooks } from '../../../types';

const syncHooks: SyncHooks = {
  async fetchTransactions(_api, _accountId, _fromDate, { onProgress }) {
    onProgress?.('Fetching...');
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

**`src/integrations/{name}/sinks/monarch/index.ts`:**
```ts
export { default as syncHooks } from './syncHooks';
```

### 1.4 Create the integration barrel

`src/integrations/{name}/index.ts`:
```ts
import * as monarchMapperNs from './sinks/monarch';

export { default as manifest }       from './manifest';
export { createApi }                 from './source/api';
export { createAuth }                from './source/auth';
export { default as injectionPoint } from './source/injectionPoint';

export const monarchMapper = monarchMapperNs;
export { default as syncHooks }      from './sinks/monarch/syncHooks';
```

### 1.5 Register in the build barrel

Edit `src/integrations/index.ts` — add the import and entry in `ALL`:

```ts
import * as mbna from './mbna';
import * as mybank from './mybank';    // ← ADD

const ALL: Record<string, IntegrationModule> = {
  mbna,
  mybank,                             // ← ADD
};
```

### 1.6 Add userscript metadata (`@match` and `@connect`)

Edit `src/userscript-metadata.cjs`:
1. Add the institution name to `@description`.
2. Add `@match https://<institution-web-domain>/*` so Tampermonkey injects the userscript on the institution's site.
3. Add `@connect <institution-api-domain>` so `GM_xmlhttpRequest` is permitted to call the institution's backend API (especially important when the API lives on a separate subdomain like `api.mybank.ca` or `app.pcfinancial.ca` while the web app is on `secure.pcfinancial.ca`).

### ✅ Milestone 1 validation

1. Build and install the userscript, then navigate to the institution's website
2. Browser console shows: `[integrationRegistry] Registered integration: mybank (My Bank)`
3. The uploader container appears on the page (empty/"not connected" is expected at this stage)
4. Open the settings modal — a "My Bank" tab appears automatically
5. No console errors about missing modules or failed imports

---

## Stage 2 — Auth detection

**Goal:** When the user is logged in, the connection status indicator shows "Connected."

**Credentials are never stored** ([ADR-010](../decisions/010-credentials-are-never-stored.md)).
A credential is anything that authenticates a request: auth/bearer tokens,
session and CSRF tokens, request-signing headers, device IDs used for auth, and
encoded IDs sent as auth headers. Use one of the three approaches below. Never
write a credential to GM storage (including `{id}_config`), never write to the
page's `localStorage`/`sessionStorage`/IndexedDB or set cookies, and never log
one. `test/guards/noStoredCredentials.test.js` fails the build if you do.

| Approach | Use when | Example |
|---|---|---|
| A. Probe-based | The session is in HttpOnly cookies the browser sends by itself | MBNA, Neo Financial |
| B. Read from the page on demand | The token is in a readable cookie or in the page's own storage (`sessionStorage` / `localStorage`) | PC Financial (`sessionStorage`), Wealthsimple (cookie), Questrade (`sessionStorage`), Canada Life (`localStorage`) |
| C. Capture in memory | The token only appears in headers of the page's own requests | Rogers Bank |

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

### Approach B: Read the token from the page on demand

If the institution keeps its token somewhere the page can read (a non-HttpOnly
cookie, `localStorage` or `sessionStorage`), read it at the moment it is
needed. Do not copy it anywhere, and never write to the page's storage: it
belongs to the institution.

```js
const TOKEN_COOKIE = 'mybank_access';

/** Read the token from the page every time; nothing is cached or stored. */
function readTokenFromPage() {
  const prefix = `${TOKEN_COOKIE}=`;
  const cookie = document.cookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : null;
  // Or, for page storage: return sessionStorage.getItem('mybank.token');
}

export function createAuth(_storage) {
  return {
    checkStatus() {
      return { authenticated: Boolean(readTokenFromPage()) };
    },
    getCredentials() {
      const token = readTokenFromPage();
      return token ? { token } : null;
    },
  };
}
```

If the API rejects a token with a 401, remember that rejection in memory until
the page's value changes, rather than retrying the same token. Wealthsimple
does this in `src/api/wealthsimple.ts`.

### Approach C: Capture from the page's own requests, held in memory

If the token only appears in the headers of the page's own API requests (e.g.,
`Authorization`, `X-Auth-Token`), capture it from those requests and keep it in
a variable for the current page. A reload starts empty and captures it again
from the page's next request.

```js
export function createAuth(_storage) {
  // Held in memory for this page only. Never write it to storage.
  let captured = null;

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
          this.addEventListener('loadend', () => {
            if (this.status >= 200 && this.status < 300) {
              captured = { token: value };
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
      return { authenticated: captured !== null };
    },
    getCredentials() {
      return captured;
    },
    clearCredentials() {
      captured = null;
    },
  };
}
```

**`setupMonitoring()`** is part of the `IntegrationAuth` contract in `src/integrations/types.ts`, but no modular integration uses approach C yet and nothing in `src/` calls it today. If you use approach C, wire up that call and check in Milestone 2 that capture works. If you use approach A or B, omit it entirely.

### ✅ Milestone 2 validation

1. Navigate to the institution's site while already logged in
2. The connection status indicator shows green/connected
3. **Approach A:** check the console for a successful API probe call
4. **Approach B:** the API probe succeeds with the token read from the page; sign out and the next probe fails
5. **Approach C:** navigate to any page that triggers an API call, then check that the API probe succeeds with the captured token. After a reload, nothing is captured until the page makes its next API call
6. **All approaches:** in the userscript manager's storage view, no value contains the token and `mybank_config` has no `auth` section. `npm test` passes `test/guards/noStoredCredentials.test.js`

---

## Stage 3 — Account discovery

**Goal:** The institution's accounts appear in the settings modal and can be mapped to Monarch accounts. Mappings persist across page loads.

### 3.1 Implement account listing in the API

Add `getAccountsSummary()` to `source/api.js`. This also serves as the Approach A auth probe:

```js
import { parseJsonBody } from '../../../core/httpResponse';

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
    return parseJsonBody(response.responseText, `MyBank API Error: ${path}`);
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

Parse response bodies with the shared helpers in `src/core/httpResponse.ts`
rather than calling `JSON.parse` directly. `parseJsonBody` turns a non-JSON
success body (a WAF or CDN error page, a rate-limit page, a truncated body)
into an error that names the call and quotes a bounded excerpt of the body.
For a GraphQL API, pass the parsed body through `unwrapGraphQLData`, which
throws with the full `errors` array, and use `extractResponseErrorDetail` to
explain a non-2xx response.

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

**Cursor pagination and late-posting buffers:** When paginating reverse-chronological posted transactions using a continuation token or cursor, do not stop pagination the instant a transaction's date is older than `startDate`. Because transactions often post several days after their original transaction date, subtract a buffer (e.g., 7 days before `startDate`) before stopping pagination early, then filter the returned array to `date >= startDate`.

**Suggesting a default first-sync start date (`suggestStartDate`):** Even when an integration does not implement full balance reconstruction (Stage 7), you can implement `suggestStartDate(api, accountId)` on `syncHooks` if the institution's account details endpoint returns the date the account was opened (e.g., `dateOpened: "2024-03-15"`). Returning `{ date: openedDate, description: 'Account open date' }` pre-populates the date picker on the user's first sync instead of defaulting to 90 days ago.

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
      request: vi.fn(),
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
| `src/core/config.ts` | Storage key constants are for legacy integrations only. New integrations declare keys in `manifest.storageKeys`. |
| `src/core/integrationCapabilities.ts` | The static `INTEGRATION_CAPABILITIES` map is for legacy integrations. Modular integrations are resolved via `getCapabilities()` → registry fallback. |
| `src/services/common/accountService.ts` | `ACCOUNT_LIST_STORAGE_KEYS` is a legacy static map. Modular integrations resolve their key from `manifest.storageKeys.accountsList`. |
| `src/services/common/configStore.ts` | `CONFIG_STORAGE_KEYS` is a legacy static map. Modular integrations resolve their config key from `manifest.storageKeys.config`. |
| `src/index.ts` | No new `if (siteFlags.isMyBank)` blocks. Modular integrations are detected automatically via `getIntegrationForHostname(window.location.hostname)` using `manifest.matchDomains`. |
| `src/ui/components/settingsModal.ts` | No new hardcoded tab entries. Modular integration tabs appear automatically via `getAllManifests()` filtered against the legacy tab set. |

---

## Final checklist

Before calling the integration done, verify every item:

### Files created
- [ ] `src/integrations/{name}/manifest.ts`
- [ ] `src/integrations/{name}/index.ts`
- [ ] `src/integrations/{name}/source/api.ts`
- [ ] `src/integrations/{name}/source/auth.ts`
- [ ] `src/integrations/{name}/source/injectionPoint.ts`
- [ ] `src/integrations/{name}/sinks/monarch/syncHooks.ts`
- [ ] `src/integrations/{name}/sinks/monarch/index.ts`
- [ ] `src/integrations/{name}/sinks/monarch/transactions.ts` *(Stage 6+, or inline in `syncHooks.ts`)*
- [ ] `src/integrations/{name}/source/balanceReconstruction.ts` *(Stage 7 only)*
- [ ] `src/integrations/{name}/sinks/monarch/balanceFormatter.ts` *(Stage 7 only)*
- [ ] `src/integrations/{name}/sinks/monarch/pendingTransactions.ts` *(Stage 8 only)*

### Registration & userscript metadata
- [ ] Added `import * as {name}` and `{name}` entry to `src/integrations/index.ts`
- [ ] Added `@match`, `@connect`, and updated `@description` in `src/userscript-metadata.cjs`

### Tests created
- [ ] `test/integrations/{name}/manifest.test.js`
- [ ] `test/integrations/{name}/api.test.js`
- [ ] `test/integrations/{name}/auth.test.js`
- [ ] `test/integrations/{name}/syncHooks.test.js` (or `sinks/transactions.test.js`)

### Correctness
- [ ] Account discovery uses deterministic backend APIs (no DOM scraping)
- [ ] Request headers minimized by elimination
- [ ] Amount signs correct: purchases negative, payments positive
- [ ] Deduplication works: re-uploading same range produces no duplicates
- [ ] `getSettledRefId` returns a stable, unique ID for every transaction
- [ ] No credential is stored: auth is read from the page on demand or held in memory ([ADR-010](../decisions/010-credentials-are-never-stored.md))
- [ ] Manifest has NO entries in `config.ts`, `integrationCapabilities.ts`, or static service maps
- [ ] Tests do NOT reference `INTEGRATION_CAPABILITIES` or `STORAGE` constants

### Build validation
- [ ] `npm run lint` — zero errors and warnings
- [ ] `npm test` — all tests pass
- [ ] `npm run build` — production build succeeds
- [ ] `npm run build:full` — full build validation passes

### README
- [ ] Add the integration to the **Supported Institutions** table in `README.md` in **alphabetical order**
      - Balance History column: `manifest.capabilities.hasBalanceHistory`
      - Transactions column: `manifest.capabilities.hasTransactions`
      - Holdings column: `manifest.capabilities.hasHoldings`
      - Credit Limit column: `manifest.capabilities.hasCreditLimit`
      - Category Mappings column: `manifest.capabilities.hasCategorization`
      - Notes column: account type (credit card, investment, etc.) and any notable constraints

### Version bump
- [ ] `npm run version:bump -- X.Y.Z` (new financial institution = **major** version bump `X+1.0.0`)
