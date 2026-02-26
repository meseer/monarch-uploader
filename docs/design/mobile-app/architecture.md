# Mobile App Architecture — High-Level Design

> **Status:** Draft  
> **Updated:** 2026-02-25  
> **Author:** @meseer  
> **Note:** Top-level design for the mobile app. See linked low-level designs for implementation detail on specific subsystems.

---

## 1. Vision and Goals

Deliver the functionality of the Monarch Uploader userscript as a native mobile app (iOS + Android) that:

- Requires **no browser extension or userscript installation** — works on any mobile device out of the box
- Authenticates with each financial institution via an **embedded WebView login flow** — users log in normally, the app captures the resulting session tokens using low-level network interception
- Makes all **financial institution API calls on-device** to leverage trusted device status, home/mobile network IP trust, and minimize re-authentication and 2FA triggers
- Supports **background sync** without user interaction (except when 2FA is required), gated on an **allowlisted network list** to avoid foreign IPs or untrusted egress points
- Stores **credentials in device-native secure storage** (iOS Keychain / Android Keystore) for silent re-authentication
- Keeps all **settings and application state in a dedicated backend**, enabling multi-device support and future analytics
- Continues to push financial data (transactions, balances, holdings) to **Monarch Money API** in the short term, with own backend storage as the long-term destination

---

## 2. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Mobile App  (React Native / Expo)                                    │
│                                                                        │
│  ┌───────────────────────┐   ┌──────────────────────────────────────┐ │
│  │  WebView Login Flows   │   │  Native Sync Engine                   │ │
│  │                        │   │  (reused from src/api/, src/services/)│ │
│  │  iOS: WKURLSchemeHandler───▶ native fetch() — no CORS restriction │ │
│  │  Android: OkHttp       │   │                                       │ │
│  │  interceptor           │   └──────────────┬───────────────────────┘ │
│  └──────────┬─────────────┘                  │                          │
│             │ token/cookie                   │ API calls                │
│             ▼                                │                          │
│  ┌───────────────────────────────────────────────────────────────────┐ │
│  │  Secure Storage  (Keychain / Keystore)                             │ │
│  │  · Institution credentials (for silent re-login)                  │ │
│  │  · Session tokens and cookies per integration                     │ │
│  │  · Network allowlist configuration                                │ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌──────────────────────────┐   ┌──────────────────────────────────┐   │
│  │  Background Sync Task    │   │  Settings / Account Mapping UI   │   │
│  │  (expo-background-fetch) │   │  (React Native screens)          │   │
│  │  · Network allowlist     │   │                                  │   │
│  │    check before sync     │   │                                  │   │
│  │  · Push notification on  │   │                                  │   │
│  │    2FA required          │   │                                  │   │
│  └──────────────────────────┘   └──────────────────────────────────┘   │
└──────────────┬───────────────────────────────┬──────────────────────────┘
               │ on-device API calls            │ settings + state
               ▼                                ▼
  Financial Institution APIs            Own Backend (Node.js + Postgres)
  · Questrade                           · User accounts + auth
  · Wealthsimple                        · Account mappings
  · Rogers Bank                         · Sync configuration
  · Canada Life                         · Sync history + logs
  · MBNA                                · Deduplication ledger
                                        · Multi-device state sync
               │                                │
               └────────────────┬───────────────┘
                                ▼
                         Monarch Money API
                    (transactions, balances,
                     holdings — Phase 1 only)
```

---

## 3. Key Design Decisions

### 3.1 On-Device API Calls (No Backend Proxy for Financial Data)

Financial institution API calls are made **directly from the mobile app**, not routed through a backend proxy. This is intentional:

- React Native's `fetch()` is not a browser — **CORS does not apply**. It is equivalent to `curl` and behaves identically to any native HTTP client.
- The iOS TLS stack (Security Framework) and Android TLS stack produce TLS fingerprints identical to Safari and Chrome respectively, which is better than any server-side proxy.
- Calling from the device's own IP (home wifi, mobile data) means the financial institution treats it as a **known trusted device on a known IP**, minimising 2FA challenges.
- **Network allowlist** (see §5) prevents calls from foreign or untrusted egress points that would trigger additional security checks.

### 3.2 WebView Login for Token Capture

The userscript relies on running inside the bank's browser tab to inherit the session. The mobile equivalent is:

1. Open an embedded WebView pointed at the institution's login page
2. The user logs in normally
3. **Low-level network interception** captures the auth token/cookie from outgoing HTTP requests — see [WebView Auth Low-Level Design](./webview-auth.md)
4. The token is saved to Keychain/Keystore
5. The WebView is dismissed; subsequent API calls use the captured token directly from native code

This approach is more robust than reading `localStorage`/`sessionStorage` via injected JavaScript because it operates at the HTTP layer and does not depend on where the web app stores its internal state.

### 3.3 Background Sync with Network Allowlist

Background sync runs without the user opening the app. The allowlist gating ensures:
- Sync only runs on **designated networks** (e.g., home wifi, personal mobile data)
- Public wifi, VPN, or networks with foreign egress IPs are excluded
- This prevents triggering location-based 2FA from unexpected IP ranges

When 2FA is required during a background sync attempt, the app sends a **push notification** prompting the user to open the app and complete authentication via WebView.

### 3.4 Own Backend for Settings and State (Phase 1)

Monarch Money's API is used for financial data storage but cannot serve as a settings backend. The own backend stores:
- Account mappings (institution account → Monarch account)
- Per-integration configuration (lookback days, category mappings, dedup state)
- Sync history and logs
- Uploaded transaction IDs (deduplication ledger)
- Network allowlist per user
- Application state for multi-device sync

In Phase 2, the backend will grow to store financial data directly, making Monarch optional.

---

## 4. Authentication Model Per Integration

| Integration | Auth Mechanism | Token Source | Re-auth Strategy |
|---|---|---|---|
| **Questrade** | Session tokens (multiple, scope-dependent) extracted from web app | `localStorage` / `sessionStorage` after WebView login | Silent re-login with stored credentials; token rotation handled automatically |
| **Wealthsimple** | Bearer token from GraphQL session | HTTP request interception — `Authorization` header | Silent re-login; token stored in Keychain |
| **Rogers Bank** | Bearer token from REST session | HTTP request interception — `Authorization` header | Silent re-login with stored credentials |
| **Canada Life** | Session cookie (Salesforce/Aura-based) | HTTP response interception — `Set-Cookie` header | WebView re-login; cookies stored in Keychain |
| **MBNA** | Session cookie | HTTP response interception — `Set-Cookie` header | WebView re-login; cookies stored in Keychain |

Details of the interception mechanism: [WebView Auth Low-Level Design](./webview-auth.md).

---

## 5. Background Sync Flow

```
Background Task triggered (OS-scheduled, ~15-30 min iOS / configurable Android)
  │
  ├─ 1. Check: current network in allowlist?
  │         (SSID match for wifi, carrier check for mobile)
  │         No → skip this cycle, reschedule
  │
  ├─ 2. For each integration with sync enabled:
  │    │
  │    ├─ a. Load token/cookie from Keychain
  │    ├─ b. Is token still valid? (expiry check)
  │    │    └─ Expired → attempt silent re-login using stored credentials
  │    │         └─ 2FA required → send push notification → stop this integration
  │    │
  │    ├─ c. Call financial institution API (native fetch)
  │    ├─ d. Apply deduplication (check dedup ledger from backend)
  │    ├─ e. Map categories, transform data
  │    ├─ f. Upload to Monarch (Phase 1) / own backend (Phase 2)
  │    └─ g. Sync updated state to own backend (dedup ledger, last sync date)
  │
  └─ 3. Send summary push notification
         "Synced 3 accounts — 12 new transactions, 3 balance updates"
```

---

## 6. Code Reuse from Existing Codebase

The existing `src/` codebase is largely portable to React Native. The service, API, and mapper layers have **no DOM dependencies**.

| Existing Layer | Mobile Reuse | Changes Required |
|---|---|---|
| `src/api/*.js` | ✅ Reuse directly | None — `fetch()` works identically in RN |
| `src/services/*.js` | ✅ Reuse directly | None — pure JS business logic |
| `src/mappers/*.js` | ✅ Reuse directly | None |
| `src/core/config.js` | ✅ Reuse directly | None |
| `src/core/httpClient.js` | ✅ Minor change | Remove GM branch; `fetch` fallback already exists |
| `src/core/storageAdapter.js` | ✅ Minor change | Replace `localStorage` with `AsyncStorage` / `expo-secure-store` |
| `src/core/state.js` | ✅ Adapt | Replace DOM event patterns with React state / context |
| `src/ui/**` | ❌ Rewrite | All DOM-based UI rewritten as React Native components |

---

## 7. Technology Stack

### Mobile App
| Concern | Choice | Rationale |
|---|---|---|
| Framework | React Native + Expo | Single codebase, iOS + Android; Expo managed workflow simplifies device APIs |
| WebView | `react-native-webview` | Mature, maintained; supports message injection and request interception hooks |
| Network interception | iOS `WKURLSchemeHandler` / Android `WebViewClient.shouldInterceptRequest` | Deep HTTP-layer access for token capture (see [webview-auth.md](./webview-auth.md)) |
| Secure storage | `expo-secure-store` | Keychain (iOS) / Keystore (Android) for tokens and credentials |
| Non-sensitive storage | `@react-native-async-storage/async-storage` | Settings, cached state |
| Background sync | `expo-background-fetch` + `expo-task-manager` | Cross-platform background task registration |
| Network detection | `expo-network` + `@react-native-community/netinfo` | Network type, SSID, carrier for allowlist checks |
| Push notifications | `expo-notifications` | 2FA prompts and sync result summaries |
| Navigation | `expo-router` | File-based routing, aligns with Expo ecosystem |

### Own Backend
| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js (TypeScript) | Maximum code reuse from existing `src/`; team familiarity |
| API style | REST (Phase 1), GraphQL (Phase 2) | REST is simple for settings CRUD; GraphQL aligns with Monarch's schema for Phase 2 |
| Database | PostgreSQL (Supabase) | Managed, free tier covers personal/small scale; Supabase adds auth built-in |
| Auth | Supabase Auth | JWT, MFA, OAuth social login; handles the app's own user accounts |
| Hosting | Supabase (Phase 1) / Fly.io (Phase 2) | Free tier sufficient initially; Fly.io for more control later |

---

## 8. Delivery Phases

### Phase 1 — Core Mobile App + Settings Backend
**Goal:** Feature parity with the userscript, mobile-native

- [ ] Backend: settings and state API (account mappings, sync config, dedup ledger)
- [ ] Mobile: WebView login + token capture for all 5 integrations
- [ ] Mobile: native API calls to financial institutions
- [ ] Mobile: manual sync trigger UI
- [ ] Mobile: account mapping and settings screens
- [ ] Monarch API integration for uploading financial data

### Phase 2 — Background Sync + Reliability
**Goal:** Hands-free operation

- [ ] Background sync task with network allowlist
- [ ] Credential storage for silent re-login
- [ ] Push notifications for 2FA prompts and sync results
- [ ] Sync history and error reporting UI

### Phase 3 — Own Data Storage
**Goal:** Monarch becomes optional

- [ ] Backend stores transactions, balances, holdings directly
- [ ] Basic reporting and analytics on owned data
- [ ] Monarch integration becomes a configurable "sink" rather than a requirement

### Phase 4 — Analytics and Budgeting
**Goal:** Full personal finance platform

- [ ] Spending trends, net worth history
- [ ] Budget creation and tracking
- [ ] Multi-institution consolidated views

---

## 9. Related Documents

- [WebView Auth — Low-Level Design](./webview-auth.md) — token capture mechanics, per-integration details, silent re-login
- [Backend — Low-Level Design](./backend.md) — API surface, data model, multi-device sync