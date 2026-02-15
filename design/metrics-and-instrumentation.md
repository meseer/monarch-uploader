# Metrics & Instrumentation Design Document

## Monarch Uploader — Telemetry System

**Version:** 1.0  
**Status:** Draft  
**Author:** AI Assistant  
**Date:** February 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Privacy Principles](#2-privacy-principles)
3. [User Identification & Authentication](#3-user-identification--authentication)
4. [Consent & Gating Strategy](#4-consent--gating-strategy)
5. [Metrics Data Model](#5-metrics-data-model)
6. [Client-Side Architecture](#6-client-side-architecture)
7. [Backend Architecture](#7-backend-architecture)
8. [Integration Points](#8-integration-points)
9. [Userscript Metadata Changes](#9-userscript-metadata-changes)
10. [README & Legal Updates](#10-readme--legal-updates)
11. [Consistency with Cloud-Sync Design](#11-consistency-with-cloud-sync-design)
12. [Implementation Phases](#12-implementation-phases)
13. [Appendix](#13-appendix)

---

## 1. Executive Summary

### Goal

Add mandatory, privacy-preserving telemetry to Monarch Uploader so the maintainer can:

- Understand usage patterns (active users, institutions used, sync frequency)
- Detect and diagnose issues for specific users (error rates, failure stages)
- Measure adoption of new features and script versions
- Gate future script updates behind metrics acceptance

### Approach

Implement a client-side metrics collection system that writes events to persistent local storage (via `GM_setValue`) and uses a decoupled background flush worker to upload batched events to a backend metrics proxy. User identity is established via mandatory Google OAuth sign-in. No customer-identifiable, financial, or authentication data is ever collected.

### Key Principles

1. **Metrics never block or delay the UI or sync operations** — collection is a synchronous write to local storage; upload is a background process
2. **Metrics survive crashes and restarts** — buffer is persisted in `GM_setValue`; the next session uploads events from the previous session
3. **Zero financial PII** — no account IDs, balances, transaction details, or auth tokens
4. **Mandatory for updates** — users must sign in to continue receiving script updates; first install gets a grace period

---

## 2. Privacy Principles

### What is NEVER Collected

| Data Category | Examples | Why Excluded |
|---|---|---|
| Account identifiers | Account IDs, names, nicknames, numbers | Customer identifiable |
| Monarch identifiers | Monarch account IDs, display names | Customer identifiable |
| Financial data | Balances, transaction amounts, credit limits | Financial PII |
| Transaction details | Merchant names, dates, descriptions | Financial PII |
| Authentication material | Tokens, passwords, API keys, cookies | Security-critical |
| Category mappings content | Merchant-to-category assignments | May reveal financial habits |
| Personal information | Email, name, phone | PII (OAuth `sub` is hashed) |

### What IS Collected

| Data Category | Examples | Purpose |
|---|---|---|
| Anonymous user ID | SHA-256 hash of Google OAuth `sub` | Unique user counting, per-user debugging |
| Device ID | Random UUID per device | Multi-device visibility per user |
| Script version | `5.85.5` | Version adoption tracking |
| Institution ID | `wealthsimple`, `questrade` | Feature usage by institution |
| Sync step results | `{ step: "balance", status: "success" }` | Reliability monitoring |
| Aggregate counts | `transactionCount: 12`, `daysUploaded: 7` | Volume metrics (no specific values) |
| Error codes/messages | `HTTP 401`, `Token expired` | Debugging |
| Timing data | `durationMs: 1500` | Performance monitoring |
| Site context | `wealthsimple.com` | Which institution site is active |

### IP Address Policy

IP addresses are seen by the backend infrastructure but are **never logged, stored, or forwarded** to observability services. The metrics proxy strips IP information before forwarding events.

---

## 3. User Identification & Authentication

### Chosen Approach: Google OAuth (Mandatory)

Users must sign in with Google to establish a stable, cross-device identity. This is the **only** supported authentication method.

**Flow:**

```
1. User clicks "Sign in with Google" in consent dialog
         │
         ▼
2. OAuth popup opens → Google login
         │
         ▼
3. Google returns id_token to client
         │
         ▼
4. Client sends id_token to backend: POST /v1/auth/google
         │
         ▼
5. Backend verifies id_token with Google, extracts `sub`
         │
         ▼
6. Backend hashes `sub` → userId, issues JWT for metrics API
         │
         ▼
7. Client stores:
   - GM_setValue('mu_user_id', userId)         // Hashed, stable across devices
   - GM_setValue('mu_auth_token', jwt)         // Short-lived JWT for API calls
   - GM_setValue('mu_metrics_consent_version', CURRENT_VERSION)
```

**Why Google OAuth:**

| Consideration | Benefit |
|---|---|
| Stable cross-device identity | Same user on home/work/laptop gets one `userId` |
| Accurate user counting | Know exactly how many unique users exist |
| User-level debugging | Can investigate issues for a specific `userId` |
| Future cloud-sync alignment | Same identity used for settings sync (see Section 11) |
| No password management | Passwordless, delegated to Google |

### Rejected Alternatives

| Alternative | Why Rejected |
|---|---|
| **Stable Device ID (random UUID)** | Cannot correlate across devices; no accurate user count; no user-level debugging; no ability to contact user |
| **Monarch Token Hash** | Tokens rotate per session; hash changes on re-login; not truly stable; couples identity to Monarch availability |
| **Email-based registration** | Requires password management or email verification flow; more complex; Google OAuth achieves the same with less friction |
| **Anonymous / No identity** | Cannot count users; cannot debug per-user issues; cannot gate updates; no accountability |

### Device Identification

In addition to the user-level `userId`, each device gets a random UUID for multi-device visibility:

```javascript
function getOrCreateDeviceId() {
  let deviceId = GM_getValue('mu_device_id');
  if (!deviceId) {
    deviceId = `dev_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    GM_setValue('mu_device_id', deviceId);
  }
  return deviceId;
}
```

The `deviceId` is reported alongside every metrics payload, allowing visibility into:
- How many devices each user has
- Which devices are on which script version
- Whether an issue is device-specific or user-wide

---

## 4. Consent & Gating Strategy

### Consent Flow

```
Script loads
    │
    ▼
Check GM_getValue('mu_metrics_consent_version')
    │
    ├── CASE 1: First-ever install (no mu_first_installed_version exists)
    │       │
    │       ▼
    │   Store GM_setValue('mu_first_installed_version', CURRENT_VERSION)
    │   Script works fully without sign-in for THIS version only
    │   Show non-blocking banner: "Sign in with Google to enable updates & cloud features"
    │   If user signs in → full metrics + update eligibility
    │   If user ignores → works fine until next version upgrade
    │
    ├── CASE 2: Existing user, consent version missing or outdated
    │       │   (mu_first_installed_version exists AND < CURRENT_VERSION)
    │       │   (OR mu_metrics_consent_version < REQUIRED_CONSENT_VERSION)
    │       ▼
    │   Show BLOCKING modal:
    │   "Sign in with Google to continue receiving updates and sync functionality"
    │   │
    │   ├── User signs in → store consent version → full operation
    │   │
    │   └── User dismisses →
    │           • Sync operations are BLOCKED (button disabled)
    │           • Settings/UI remain accessible (read-only view)
    │           • Persistent warning banner shown on every page load
    │           • Script will not auto-update to future versions
    │           • Modal re-shown on every subsequent page load
    │
    └── CASE 3: Already consented (mu_metrics_consent_version matches)
            │
            ▼
        Normal operation with metrics enabled
```

### Consent Storage Keys

```javascript
METRICS_USER_ID: 'mu_user_id',                        // Hashed OAuth sub
METRICS_DEVICE_ID: 'mu_device_id',                     // Random UUID per device
METRICS_AUTH_TOKEN: 'mu_auth_token',                    // JWT for metrics API
METRICS_CONSENT_VERSION: 'mu_metrics_consent_version',  // Tracks consent version
METRICS_FIRST_INSTALLED_VERSION: 'mu_first_installed_version', // Version that first installed metrics
METRICS_BUFFER: 'mu_metrics_buffer',                    // Persisted event buffer
```

### Consent Version Strategy

The `REQUIRED_CONSENT_VERSION` is a simple integer that increments when the privacy policy or data collection scope changes materially. This allows re-prompting users for consent when the terms change.

```javascript
const REQUIRED_CONSENT_VERSION = 1; // Increment when privacy policy changes
```

---

## 5. Metrics Data Model

### 5.1 Payload Envelope

Every metrics upload is a batch of events wrapped in a common envelope:

```json
{
  "userId": "a1b2c3d4e5f6...",
  "deviceId": "dev_1707955200_k3jf8a2m9",
  "scriptVersion": "5.85.5",
  "sessionId": "550e8400-e29b-41d4-a716-446655440000",
  "site": "wealthsimple.com",
  "events": [
    {
      "type": "sync_started",
      "timestamp": "2026-02-14T21:00:00.000Z",
      "data": { ... }
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `userId` | string | SHA-256 hash of Google OAuth `sub` (first 32 chars) |
| `deviceId` | string | Random UUID unique to this device |
| `scriptVersion` | string | Semver version from `scriptInfo.json` |
| `sessionId` | string | UUID generated per page load (groups events within a session) |
| `site` | string | Hostname of the current site (`wealthsimple.com`, `questrade.com`, etc.) |
| `events` | array | Array of event objects |

### 5.2 Event Types

#### `script_loaded`

Emitted when the script initializes on a site.

```json
{
  "type": "script_loaded",
  "timestamp": "2026-02-14T21:00:00.000Z",
  "data": {
    "site": "wealthsimple.com",
    "scriptVersion": "5.85.5",
    "hasMonarchToken": true,
    "hasInstitutionAuth": true
  }
}
```

#### `sync_started`

Emitted when the user initiates a sync operation.

```json
{
  "type": "sync_started",
  "timestamp": "2026-02-14T21:00:01.000Z",
  "data": {
    "integrationId": "wealthsimple",
    "accountCount": 3,
    "skippedCount": 1
  }
}
```

#### `sync_account_result`

Emitted per account after all sync steps complete. Uses an ordinal `accountIndex` (0, 1, 2...) instead of actual account IDs.

```json
{
  "type": "sync_account_result",
  "timestamp": "2026-02-14T21:00:05.000Z",
  "data": {
    "integrationId": "wealthsimple",
    "accountIndex": 0,
    "accountType": "CREDIT_CARD",
    "steps": [
      {
        "step": "transactions",
        "status": "success",
        "transactionCount": 12,
        "skippedCount": 3,
        "durationMs": 1500
      },
      {
        "step": "pendingReconciliation",
        "status": "success",
        "deletedCount": 0,
        "durationMs": 200
      },
      {
        "step": "creditLimit",
        "status": "success",
        "durationMs": 100
      },
      {
        "step": "balance",
        "status": "success",
        "daysUploaded": 7,
        "durationMs": 800
      },
      {
        "step": "positions",
        "status": "success",
        "positionsProcessed": 5,
        "holdingsRemoved": 0,
        "durationMs": 600
      },
      {
        "step": "cashSync",
        "status": "success",
        "cashSynced": 2,
        "durationMs": 300
      }
    ],
    "overallStatus": "success",
    "totalDurationMs": 3500
  }
}
```

**Step status values:** `success`, `error`, `skipped`

**Step-specific metadata (all optional, counts only — never amounts):**

| Step | Extra Fields |
|---|---|
| `transactions` | `transactionCount`, `skippedCount` |
| `pendingReconciliation` | `deletedCount`, `noChangeCount` |
| `creditLimit` | _(none beyond status)_ |
| `balance` | `daysUploaded` |
| `positions` | `positionsProcessed`, `holdingsRemoved`, `mappingsAutoRepaired` |
| `cashSync` | `cashSynced`, `cashSkipped` |

#### `sync_completed`

Emitted when the entire sync operation finishes.

```json
{
  "type": "sync_completed",
  "timestamp": "2026-02-14T21:00:15.000Z",
  "data": {
    "integrationId": "wealthsimple",
    "summary": {
      "success": 2,
      "failed": 0,
      "skipped": 1
    },
    "totalDurationMs": 8500,
    "cancelled": false
  }
}
```

#### `auth_status`

Emitted periodically (e.g., on each `script_loaded`) to track auth health. No token values — only boolean presence.

```json
{
  "type": "auth_status",
  "timestamp": "2026-02-14T21:00:00.000Z",
  "data": {
    "integrationId": "wealthsimple",
    "hasInstitutionAuth": true,
    "hasMonarchToken": true
  }
}
```

#### `error`

Emitted for notable errors (unhandled exceptions, API failures beyond normal sync step tracking).

```json
{
  "type": "error",
  "timestamp": "2026-02-14T21:01:00.000Z",
  "data": {
    "integrationId": "wealthsimple",
    "stage": "balance_upload",
    "errorCode": "HTTP_500",
    "errorMessage": "Internal Server Error",
    "fatal": false
  }
}
```

#### `settings_opened`

Emitted when the user opens the settings modal.

```json
{
  "type": "settings_opened",
  "timestamp": "2026-02-14T21:02:00.000Z",
  "data": {
    "integrationId": "wealthsimple"
  }
}
```

---

## 6. Client-Side Architecture

### 6.1 File Structure

```
src/
├── services/
│   └── metrics/
│       ├── metricsCollector.js    # Event buffering to GM_setValue, background flush worker
│       ├── metricsClient.js       # HTTP transport to metrics API via GM_xmlhttpRequest
│       ├── metricsEvents.js       # Event type definitions & builder functions
│       └── metricsAuth.js         # Google OAuth flow, userId/JWT management
├── core/
│   └── metricsConfig.js           # Metrics endpoint URL, flush interval, buffer limits
└── ui/
    └── components/
        └── metricsConsentDialog.js # Consent modal & sign-in UI
```

### 6.2 Metrics Collector — Local Storage Buffer + Background Worker

The core design principle: **collection is a synchronous local write; upload is an asynchronous background task.**

```javascript
// src/services/metrics/metricsCollector.js

import { METRICS_CONFIG } from '../../core/metricsConfig';
import { metricsClient } from './metricsClient';

const BUFFER_STORAGE_KEY = 'mu_metrics_buffer';
const MAX_BUFFER_SIZE = 500;

class MetricsCollector {
  constructor() {
    this.sessionId = null;
    this.flushIntervalId = null;
    this.initialized = false;
  }

  /**
   * Initialize the collector and start the background flush worker.
   * Called once during app initialization after consent is verified.
   */
  initialize() {
    if (this.initialized) return;

    this.sessionId = crypto.randomUUID();
    this.initialized = true;

    // Start background flush worker
    this.flushIntervalId = setInterval(
      () => this.flush(),
      METRICS_CONFIG.FLUSH_INTERVAL_MS
    );

    // Best-effort flush on page unload
    window.addEventListener('beforeunload', () => this.flush());
  }

  /**
   * Track an event. SYNCHRONOUS — writes to GM_setValue only.
   * Zero impact on UI or sync operations.
   *
   * @param {string} eventType - Event type (e.g., 'sync_started')
   * @param {Object} data - Event-specific data
   */
  track(eventType, data = {}) {
    if (!this.initialized) return;

    const event = {
      type: eventType,
      timestamp: new Date().toISOString(),
      data,
    };

    const buffer = GM_getValue(BUFFER_STORAGE_KEY, []);
    buffer.push(event);

    // Evict oldest events if over capacity
    while (buffer.length > MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    GM_setValue(BUFFER_STORAGE_KEY, buffer);
  }

  /**
   * Background flush — reads buffer, sends batch, clears sent events.
   * Runs on setInterval and beforeunload. Failures keep events in buffer.
   */
  async flush() {
    const buffer = GM_getValue(BUFFER_STORAGE_KEY, []);
    if (buffer.length === 0) return;

    const eventsToSend = [...buffer];

    try {
      await metricsClient.sendBatch(eventsToSend);

      // On success: remove sent events from buffer
      const currentBuffer = GM_getValue(BUFFER_STORAGE_KEY, []);
      const remaining = currentBuffer.slice(eventsToSend.length);
      GM_setValue(BUFFER_STORAGE_KEY, remaining);
    } catch {
      // On failure: events stay in buffer for next flush cycle
    }
  }

  /**
   * Stop the background flush worker.
   */
  destroy() {
    if (this.flushIntervalId) {
      clearInterval(this.flushIntervalId);
      this.flushIntervalId = null;
    }
    this.initialized = false;
  }
}

export const metricsCollector = new MetricsCollector();
```

**Design properties:**

| Property | Detail |
|---|---|
| `track()` latency | ~0ms — synchronous `GM_setValue` write |
| Buffer persistence | Survives page close, crash, restart |
| Flush frequency | Every 60 seconds (configurable) |
| Failure handling | Silent — events stay in buffer, retry next cycle |
| Max buffer size | 500 events, oldest-first eviction |
| Page unload | Best-effort flush via `beforeunload` |

### 6.3 Metrics Client — HTTP Transport

```javascript
// src/services/metrics/metricsClient.js

import { METRICS_CONFIG } from '../../core/metricsConfig';
import scriptInfo from '../../scriptInfo.json';

class MetricsClient {
  /**
   * Send a batch of events to the metrics backend.
   * Uses GM_xmlhttpRequest for cross-origin support.
   *
   * @param {Array} events - Array of event objects
   * @returns {Promise<void>}
   */
  async sendBatch(events) {
    const userId = GM_getValue('mu_user_id', null);
    const deviceId = GM_getValue('mu_device_id', null);
    const authToken = GM_getValue('mu_auth_token', null);

    if (!userId || !authToken) return;

    const payload = {
      userId,
      deviceId,
      scriptVersion: scriptInfo.version,
      sessionId: metricsCollector?.sessionId || 'unknown',
      site: window.location.hostname,
      events,
    };

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'POST',
        url: `${METRICS_CONFIG.ENDPOINT_URL}/v1/events`,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        data: JSON.stringify(payload),
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve();
          } else {
            reject(new Error(`Metrics upload failed: HTTP ${response.status}`));
          }
        },
        onerror: () => reject(new Error('Metrics upload: network error')),
        ontimeout: () => reject(new Error('Metrics upload: timeout')),
      });
    });
  }
}

export const metricsClient = new MetricsClient();
```

### 6.4 Metrics Configuration

```javascript
// src/core/metricsConfig.js

export const METRICS_CONFIG = {
  // Backend endpoint (placeholder until domain is finalized)
  ENDPOINT_URL: 'https://api.{DOMAIN}.com',

  // Background flush interval (milliseconds)
  FLUSH_INTERVAL_MS: 60000, // 60 seconds

  // Maximum events in local buffer before oldest-first eviction
  MAX_BUFFER_SIZE: 500,

  // Current consent version — increment when privacy policy changes
  REQUIRED_CONSENT_VERSION: 1,

  // Google OAuth client ID (set during backend setup)
  GOOGLE_OAUTH_CLIENT_ID: '{GOOGLE_CLIENT_ID}',
};
```

### 6.5 Event Builder Functions

```javascript
// src/services/metrics/metricsEvents.js

/**
 * Build a script_loaded event
 */
export function buildScriptLoadedEvent(site, hasMonarchToken, hasInstitutionAuth) {
  return { type: 'script_loaded', data: { site, hasMonarchToken, hasInstitutionAuth } };
}

/**
 * Build a sync_started event
 */
export function buildSyncStartedEvent(integrationId, accountCount, skippedCount) {
  return { type: 'sync_started', data: { integrationId, accountCount, skippedCount } };
}

/**
 * Build a sync_account_result event
 */
export function buildSyncAccountResultEvent(integrationId, accountIndex, accountType, steps, overallStatus, totalDurationMs) {
  return {
    type: 'sync_account_result',
    data: { integrationId, accountIndex, accountType, steps, overallStatus, totalDurationMs },
  };
}

/**
 * Build a sync_completed event
 */
export function buildSyncCompletedEvent(integrationId, summary, totalDurationMs, cancelled) {
  return { type: 'sync_completed', data: { integrationId, summary, totalDurationMs, cancelled } };
}

/**
 * Build an error event
 */
export function buildErrorEvent(integrationId, stage, errorCode, errorMessage, fatal = false) {
  return { type: 'error', data: { integrationId, stage, errorCode, errorMessage, fatal } };
}

/**
 * Build an auth_status event
 */
export function buildAuthStatusEvent(integrationId, hasInstitutionAuth, hasMonarchToken) {
  return { type: 'auth_status', data: { integrationId, hasInstitutionAuth, hasMonarchToken } };
}

/**
 * Build a settings_opened event
 */
export function buildSettingsOpenedEvent(integrationId) {
  return { type: 'settings_opened', data: { integrationId } };
}
```

### 6.6 Metrics Auth — Google OAuth

```javascript
// src/services/metrics/metricsAuth.js

import { METRICS_CONFIG } from '../../core/metricsConfig';

/**
 * Initiate Google OAuth sign-in flow.
 * Opens a popup window for Google authentication.
 *
 * @returns {Promise<{userId: string, authToken: string}>}
 */
export async function signInWithGoogle() {
  const idToken = await openGoogleOAuthPopup();
  const result = await exchangeTokenWithBackend(idToken);

  GM_setValue('mu_user_id', result.userId);
  GM_setValue('mu_auth_token', result.authToken);
  GM_setValue('mu_metrics_consent_version', METRICS_CONFIG.REQUIRED_CONSENT_VERSION);

  return result;
}

function openGoogleOAuthPopup() {
  return new Promise((resolve, reject) => {
    const clientId = METRICS_CONFIG.GOOGLE_OAUTH_CLIENT_ID;
    const redirectUri = `${METRICS_CONFIG.ENDPOINT_URL}/v1/auth/callback`;
    const nonce = crypto.randomUUID();

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?'
      + `client_id=${encodeURIComponent(clientId)}`
      + `&redirect_uri=${encodeURIComponent(redirectUri)}`
      + '&response_type=id_token'
      + '&scope=openid'
      + `&nonce=${encodeURIComponent(nonce)}`
      + '&prompt=select_account';

    const popup = window.open(authUrl, 'mu_google_auth', 'width=500,height=600');
    if (!popup) {
      reject(new Error('Popup blocked. Please allow popups for this site.'));
      return;
    }

    const handler = (event) => {
      if (event.origin !== new URL(METRICS_CONFIG.ENDPOINT_URL).origin) return;
      if (event.data?.type === 'mu_auth_callback') {
        window.removeEventListener('message', handler);
        if (event.data.idToken) {
          resolve(event.data.idToken);
        } else {
          reject(new Error(event.data.error || 'Authentication failed'));
        }
        popup.close();
      }
    };

    window.addEventListener('message', handler);

    setTimeout(() => {
      window.removeEventListener('message', handler);
      if (!popup.closed) popup.close();
      reject(new Error('Authentication timed out'));
    }, 300000);
  });
}

async function exchangeTokenWithBackend(idToken) {
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      method: 'POST',
      url: `${METRICS_CONFIG.ENDPOINT_URL}/v1/auth/google`,
      headers: { 'Content-Type': 'application/json' },
      data: JSON.stringify({ idToken }),
      onload: (response) => {
        if (response.status === 200) {
          const result = JSON.parse(response.responseText);
          resolve({ userId: result.userId, authToken: result.authToken });
        } else {
          reject(new Error(`Auth exchange failed: HTTP ${response.status}`));
        }
      },
      onerror: () => reject(new Error('Auth exchange failed: network error')),
    });
  });
}

/**
 * Check if the user is authenticated for metrics.
 */
export function isMetricsAuthenticated() {
  const userId = GM_getValue('mu_user_id', null);
  const consentVersion = GM_getValue('mu_metrics_consent_version', 0);
  return Boolean(userId) && consentVersion >= METRICS_CONFIG.REQUIRED_CONSENT_VERSION;
}

/**
 * Check if this is the first install of a metrics-capable version.
 */
export function isFirstMetricsInstall() {
  return !GM_getValue('mu_first_installed_version', null);
}

/**
 * Record the first installed version.
 */
export function recordFirstInstall(version) {
  GM_setValue('mu_first_installed_version', version);
}

/**
 * Check if sync should be blocked due to missing metrics consent.
 * Blocked if: not first install AND not authenticated.
 */
export function isSyncBlockedByMetrics() {
  if (isMetricsAuthenticated()) return false;
  const firstVersion = GM_getValue('mu_first_installed_version', null);
  return Boolean(firstVersion);
}
```

### 6.7 Consent Dialog UI

The consent dialog is shown as a modal overlay. The design adapts based on whether it's blocking (existing user upgrade) or non-blocking (first install).

```
┌──────────────────────────────────────────┐
│  📊 Monarch Uploader — Sign In Required  │
│                                          │
│  Starting with this version, Monarch     │
│  Uploader collects anonymous usage       │
│  metrics to improve reliability and      │
│  enable future features like cloud sync. │
│                                          │
│  ✅ What we collect:                     │
│  • Sync success/failure per institution  │
│  • Number of transactions synced         │
│  • Script version and error codes        │
│  • Anonymous user identifier             │
│                                          │
│  ❌ What we NEVER collect:               │
│  • Account names, IDs, or balances       │
│  • Transaction details or amounts        │
│  • Authentication tokens                 │
│  • Any personally identifiable info      │
│                                          │
│  Sign-in is required to continue         │
│  receiving updates and sync              │
│  functionality. Without sign-in, your    │
│  setup may break in future versions      │
│  as we cannot provide safe data          │
│  migrations without telemetry.           │
│                                          │
│  📄 Privacy policy:                      │
│  {DOMAIN}.com/privacy                    │
│                                          │
│  [  Sign in with Google  ]               │
│                                          │
└──────────────────────────────────────────┘
```

**Blocking mode (upgrade):** Modal cannot be dismissed. Sync button is disabled. Warning banner persists.

**Non-blocking mode (first install):** Modal can be dismissed. Sync works. Banner gently reminds user to sign in.

---

## 7. Backend Architecture

### 7.1 High-Level Architecture

```
┌─────────────────────────┐
│   Userscript            │
│   (GM_xmlhttpRequest)   │
└────────────┬────────────┘
             │ HTTPS POST /v1/events
             │ HTTPS POST /v1/auth/google
             ▼
┌─────────────────────────┐
│   API Gateway / Edge    │  api.{DOMAIN}.com
│   (Cloudflare Workers   │  - TLS termination
│    or AWS API Gateway)  │  - Rate limiting (per userId)
│                         │  - JWT validation
│                         │  - Request size limits
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│   Metrics Proxy         │  Lightweight Lambda / Worker
│   Service               │  - Validate payload schema
│                         │  - Strip IP addresses
│                         │  - Enrich with server timestamp
│                         │  - Forward to observability
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   Managed Observability                 │
│   (PostHog / Grafana Cloud / Datadog)   │
│   - Dashboards & visualizations         │
│   - Alerting (error rate spikes, etc.)  │
│   - User-level drill-down by userId     │
│   - Version adoption tracking           │
└─────────────────────────────────────────┘
```

**Recommended stack:** Cloudflare Workers (generous free tier, edge-deployed, minimal cold start) → PostHog (generous free tier, built for product analytics with user-level drill-down).

### 7.2 API Endpoints

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/v1/auth/google` | POST | Exchange Google `id_token` for `userId` + JWT | None (public) |
| `/v1/auth/callback` | GET | OAuth redirect page (posts `id_token` back to opener via `postMessage`) | None (public) |
| `/v1/events` | POST | Submit batched metrics events | JWT required |
| `/v1/health` | GET | Health check | None |

### 7.3 Auth Endpoint Detail

```
POST /v1/auth/google
Content-Type: application/json

Request:
{
  "idToken": "eyJhbGciOiJSUzI1NiIs..."
}

Response (200):
{
  "userId": "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
  "authToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

Backend logic:
1. Verify `idToken` with Google's public keys
2. Extract `sub` from verified token payload
3. Hash: `userId = SHA256("mu_" + sub).substring(0, 32)`
4. Generate JWT: `{ userId, deviceId (from request), iat, exp: 30d }`
5. Return `userId` and JWT

### 7.4 Events Endpoint Detail

```
POST /v1/events
Authorization: Bearer <jwt>
Content-Type: application/json

Request:
{
  "userId": "a1b2c3d4...",
  "deviceId": "dev_170795...",
  "scriptVersion": "5.85.5",
  "sessionId": "550e8400...",
  "site": "wealthsimple.com",
  "events": [...]
}

Response: 202 Accepted
```

Backend logic:
1. Validate JWT, extract `userId`
2. Verify `userId` in JWT matches `userId` in payload
3. Validate payload schema (max 100 events per batch, max 50KB)
4. Strip source IP from forwarded data
5. Add `receivedAt` server timestamp
6. Forward to observability service
7. Return 202 immediately (fire-and-forget from client perspective)

### 7.5 Rate Limiting

| Limit | Value | Scope |
|---|---|---|
| Events per minute | 100 | Per `userId` |
| Batches per minute | 5 | Per `userId` |
| Payload size | 50 KB | Per request |
| Auth requests | 10 per hour | Per IP |

### 7.6 Domain Name

**Status:** To be decided. Placeholder `{DOMAIN}` used throughout this document.

Brand name candidates (lightweight, finance/responsibility, evocative):

| Name | Rationale |
|---|---|
| **Steward** | Financial stewardship; careful management; easy to remember |
| **Regent** | Deputy to a monarch — subtle connection to Monarch; unique |
| **Sterling** | Currency reference (pound sterling); connotes quality |
| **Provident** | Financial foresight; prudent planning |
| **Noble** | Quality + royalty connection |
| **Vigil** | Watchfulness; protection — fits monitoring angle |

The domain will serve as the base for both metrics (`api.{DOMAIN}.com`) and future cloud-sync services.

---

## 8. Integration Points

Metrics hooks are added at the **service layer**, consistent with the project's separation of concerns guidelines. The UI and API layers remain unmodified.

### 8.1 Hook Locations

| Source File | Hook Point | Event(s) |
|---|---|---|
| `src/index.js` | `initApp()` | `script_loaded`, `auth_status` |
| `src/index.js` | Consent gate (new) | Consent flow initialization |
| `src/services/wealthsimple-upload.js` | `uploadAllWealthsimpleAccountsToMonarch()` | `sync_started`, `sync_completed` |
| `src/services/wealthsimple-upload.js` | `uploadWealthsimpleAccountToMonarchWithSteps()` | `sync_account_result` |
| `src/services/rogersbank-upload.js` | Upload entry point | `sync_started`, `sync_account_result`, `sync_completed` |
| `src/services/canadalife-upload.js` | Upload entry point | `sync_started`, `sync_account_result`, `sync_completed` |
| `src/services/questrade/sync.js` | Sync entry point | `sync_started`, `sync_account_result`, `sync_completed` |
| `src/ui/components/settingsModal.js` | Modal open handler | `settings_opened` |
| Error boundaries in upload services | catch blocks | `error` |

### 8.2 Example: Wealthsimple Integration

```javascript
// In uploadAllWealthsimpleAccountsToMonarch():

// At start:
metricsCollector.track('sync_started', {
  integrationId: 'wealthsimple',
  accountCount: accountsToSync.length,
  skippedCount: skippedCount,
});

const syncStartTime = Date.now();

// After each account (in uploadWealthsimpleAccountToMonarchWithSteps):
metricsCollector.track('sync_account_result', {
  integrationId: 'wealthsimple',
  accountIndex: index,          // Ordinal, NOT account ID
  accountType: account.type,    // e.g., 'CREDIT_CARD'
  steps: stepResults,           // Array of {step, status, ...counts, durationMs}
  overallStatus: result.success ? 'success' : 'error',
  totalDurationMs: Date.now() - accountStartTime,
});

// At end:
metricsCollector.track('sync_completed', {
  integrationId: 'wealthsimple',
  summary: { success: stats.success, failed: totalFailed, skipped: totalSkipped },
  totalDurationMs: Date.now() - syncStartTime,
  cancelled: isCancelled,
});
```

### 8.3 Sync Blocking Integration

```javascript
// In each upload service's entry point, before starting sync:

import { isSyncBlockedByMetrics } from '../services/metrics/metricsAuth';
import { showMetricsConsentDialog } from '../ui/components/metricsConsentDialog';

if (isSyncBlockedByMetrics()) {
  showMetricsConsentDialog({ blocking: true });
  return; // Do not proceed with sync
}
```

### 8.4 Initialization Integration

```javascript
// In src/index.js, at the top of initApp():

import { isMetricsAuthenticated, isFirstMetricsInstall, recordFirstInstall } from './services/metrics/metricsAuth';
import { metricsCollector } from './services/metrics/metricsCollector';
import { showMetricsConsentDialog } from './ui/components/metricsConsentDialog';
import scriptInfo from './scriptInfo.json';

// Metrics initialization
if (isFirstMetricsInstall()) {
  recordFirstInstall(scriptInfo.version);
  // Show non-blocking banner (first install grace period)
  showMetricsConsentDialog({ blocking: false });
}

if (isMetricsAuthenticated()) {
  metricsCollector.initialize();
  metricsCollector.track('script_loaded', {
    site: window.location.hostname,
    scriptVersion: scriptInfo.version,
    hasMonarchToken: Boolean(GM_getValue(STORAGE.MONARCH_TOKEN)),
    hasInstitutionAuth: true, // Set per-institution
  });
}
```

---

## 9. Userscript Metadata Changes

The following changes are needed in `src/userscript-metadata.cjs`:

### 9.1 New `@connect` Directive

Add a `@connect` entry for the metrics API domain:

```
// @connect      api.{DOMAIN}.com
```

This allows `GM_xmlhttpRequest` to make cross-origin requests to the metrics backend.

### 9.2 New `@connect` for Google OAuth

```
// @connect      accounts.google.com
```

Required for the OAuth popup to communicate back.

### 9.3 Updated `@grant` (No Changes Needed)

The existing grants (`GM_getValue`, `GM_setValue`, `GM_xmlhttpRequest`) already cover all metrics needs. No new grants are required.

---

## 10. README & Legal Updates

### 10.1 README.md — New Section

Add after the "Usage" section:

```markdown
## Telemetry & Privacy

Starting with version X.Y.0, Monarch Uploader collects **mandatory anonymous usage metrics**
to improve reliability, detect issues, and enable future features like cloud settings sync.

### What is collected
- Sync success/failure status per institution (e.g., "Wealthsimple balance upload: success")
- Aggregate counts (e.g., "12 transactions synced") — never specific amounts or details
- Script version and error codes for debugging
- Anonymous user identifier via Google Sign-In (hashed, not your email or name)
- Device identifier for multi-device visibility

### What is NEVER collected
- Account names, numbers, IDs, or balances
- Transaction details (merchants, amounts, dates)
- Authentication tokens or credentials
- Category mappings or any financial behavior data
- Your email, name, or any personally identifiable information

### Sign-in requirement
You must sign in with Google to continue receiving script updates and sync functionality.
This provides a stable anonymous identity for metrics and future cloud features.
If you do not wish to participate, please uninstall the script.

For full details, see our [Privacy Policy]({DOMAIN}.com/privacy).
```

### 10.2 Privacy Policy Page

Host at `{DOMAIN}.com/privacy`. Must cover:

1. **Data collected** — exhaustive list matching Section 2 of this document
2. **Data NOT collected** — exhaustive list matching Section 2
3. **How data is used** — reliability monitoring, debugging, version tracking
4. **Data storage** — where (region), how long (retention policy), encryption
5. **Third-party services** — observability provider (e.g., PostHog), Cloudflare
6. **Google OAuth** — only `openid` scope requested; no access to email, profile, or contacts
7. **Data deletion** — how to request deletion of all data associated with a `userId`
8. **Contact information** — how to reach the maintainer

### 10.3 LICENSE Updates

No changes needed to the CC BY-NC-SA 4.0 license. The privacy policy is a separate legal document.

---

## 11. Consistency with Cloud-Sync Design

The cloud-sync design (`design/cloud-sync.md`) must be updated to align with the metrics identity layer. Both features share the same user identity and device identity.

### 11.1 Changes to Cloud-Sync Design

| Aspect | Cloud-Sync (old) | Cloud-Sync (updated) | Rationale |
|---|---|---|---|
| **User ID source** | Hash of Monarch JWT `sub` | Google OAuth `userId` (from `mu_user_id`) | Stable across sessions; doesn't depend on Monarch availability |
| **Device ID key** | `sync_device_id` | `mu_device_id` (shared with metrics) | Single device identifier for all backend features |
| **Auth method** | Firebase anonymous / custom token | Google OAuth JWT (same as metrics) | Single sign-in for both features |
| **Backend domain** | `monarch-uploader-sync.firebaseapp.com` | `api.{DOMAIN}.com` (Firebase can still be backing store) | Unified API surface |
| **User hash function** | `SHA256("monarch_uploader_sync_" + monarchSub)` | `SHA256("mu_" + googleSub)` | Uses Google identity, not Monarch token |

### 11.2 Shared Identity Layer

```
┌──────────────────────────────────────────┐
│           Google OAuth Sign-In           │
│         (one-time, cross-device)         │
└──────────────────┬───────────────────────┘
                   │
          ┌────────┴────────┐
          ▼                 ▼
   ┌─────────────┐  ┌─────────────┐
   │   Metrics   │  │  Cloud Sync │
   │   Service   │  │   Service   │
   │             │  │             │
   │ userId ─────│──│── userId    │
   │ deviceId ───│──│── deviceId  │
   │ JWT ────────│──│── JWT       │
   └─────────────┘  └─────────────┘
```

Both services read from the same `GM_setValue` keys:
- `mu_user_id` — hashed Google OAuth `sub`
- `mu_device_id` — random UUID per device
- `mu_auth_token` — JWT (may need different scopes for sync vs metrics)

### 11.3 Firebase Database Key Update

The Firebase database key changes from `users/{monarchTokenHash}` to `users/{googleOAuthUserId}`:

```javascript
// Old (cloud-sync.md v1.0):
const userHash = SHA256("monarch_uploader_sync_" + monarchJwtSub);
const userRef = ref(database, `users/${userHash}`);

// New (aligned with metrics):
const userId = GM_getValue('mu_user_id'); // Set during Google OAuth
const userRef = ref(database, `users/${userId}`);
```

---

## 12. Implementation Phases

### Phase 1: Foundation — Client-Side Collection (est. 2–3 days)

- [ ] Create `src/core/metricsConfig.js` with endpoint URLs and constants
- [ ] Implement `src/services/metrics/metricsEvents.js` with event type builders
- [ ] Implement `src/services/metrics/metricsCollector.js` with local buffer + background flush
- [ ] Implement `src/services/metrics/metricsClient.js` using `GM_xmlhttpRequest`
- [ ] Add metrics storage keys to `src/core/config.js`
- [ ] Add `@connect` directives to `src/userscript-metadata.cjs`
- [ ] Unit tests for all metrics modules

### Phase 2: Consent & Auth (est. 2–3 days)

- [ ] Implement `src/services/metrics/metricsAuth.js` with Google OAuth flow
- [ ] Implement `src/ui/components/metricsConsentDialog.js` (blocking + non-blocking modes)
- [ ] Integrate consent gate into `src/index.js` initialization flow
- [ ] Implement sync blocking in upload service entry points
- [ ] Unit tests for auth and consent logic

### Phase 3: Integration Hooks (est. 2–3 days)

- [ ] Add metrics hooks to `src/services/wealthsimple-upload.js`
- [ ] Add metrics hooks to `src/services/rogersbank-upload.js`
- [ ] Add metrics hooks to `src/services/canadalife-upload.js`
- [ ] Add metrics hooks to `src/services/questrade/sync.js`
- [ ] Add `script_loaded` and `auth_status` events to `src/index.js`
- [ ] Add `settings_opened` event to settings modal
- [ ] Integration tests

### Phase 4: Backend (est. 2–3 days, can parallel with Phase 1–3)

- [ ] Register domain
- [ ] Set up Cloudflare Worker (or AWS Lambda) for metrics proxy
- [ ] Implement `/v1/auth/google` endpoint with Google token verification
- [ ] Implement `/v1/auth/callback` redirect page for OAuth popup
- [ ] Implement `/v1/events` endpoint with schema validation
- [ ] Configure observability backend (PostHog / Grafana Cloud)
- [ ] Deploy and test end-to-end

### Phase 5: Documentation & Launch (est. 1 day)

- [ ] Update `README.md` with telemetry section
- [ ] Create privacy policy page at `{DOMAIN}.com/privacy`
- [ ] Update `design/cloud-sync.md` for identity alignment (see Section 11)
- [ ] Version bump (minor — new feature)
- [ ] Build validation: `npm run lint && npm test && npm run build && npm run build:full`
- [ ] Release with consent gate enabled

---

## 13. Appendix

### A. Storage Keys Reference

| Key | Type | Purpose |
|---|---|---|
| `mu_user_id` | string | SHA-256 hash of Google OAuth `sub` (first 32 chars) |
| `mu_device_id` | string | Random UUID unique to this device |
| `mu_auth_token` | string | JWT for authenticating with metrics/sync API |
| `mu_metrics_consent_version` | number | Tracks which consent version user accepted |
| `mu_first_installed_version` | string | Script version when metrics was first available |
| `mu_metrics_buffer` | array | Persisted event buffer for background flush |

### B. Event Type Reference

| Event Type | When Emitted | Key Data Fields |
|---|---|---|
| `script_loaded` | Script initializes on any site | `site`, `hasMonarchToken`, `hasInstitutionAuth` |
| `sync_started` | User clicks upload button | `integrationId`, `accountCount`, `skippedCount` |
| `sync_account_result` | Each account completes sync | `integrationId`, `accountIndex`, `accountType`, `steps[]`, `overallStatus` |
| `sync_completed` | Entire sync finishes | `integrationId`, `summary`, `totalDurationMs`, `cancelled` |
| `auth_status` | On `script_loaded` | `integrationId`, `hasInstitutionAuth`, `hasMonarchToken` |
| `error` | Notable errors | `integrationId`, `stage`, `errorCode`, `errorMessage`, `fatal` |
| `settings_opened` | User opens settings | `integrationId` |

### C. Estimated Data Volume

| Metric | Estimate |
|---|---|
| Events per sync session | 5–20 (1 started + N accounts + 1 completed) |
| Payload size per batch | 2–10 KB |
| Flushes per user session | 1–5 (60s interval, typical session 1–5 min) |
| Storage per user per month | ~50–200 KB on observability platform |
| Free tier capacity (PostHog) | 1M events/month → ~50K–200K sync sessions |

### D. Security Considerations

| Concern | Mitigation |
|---|---|
| JWT theft | Short expiry (30 days); JWTs only authorize metrics writes for the specific `userId` |
| Replay attacks | Server-side deduplication by `sessionId` + event `timestamp` |
| Payload tampering | JWT validates `userId`; backend verifies JWT `userId` matches payload `userId` |
| Data exfiltration | Only anonymous metadata; no financial data ever reaches the backend |
| MITM | TLS everywhere; `@connect` restricts allowed domains |

### E. Future Enhancements

- **Real-time alerting:** Notify maintainer when error rate exceeds threshold for any integration
- **Version rollback detection:** Alert when users downgrade to older versions
- **Feature flags:** Use metrics identity to enable/disable features per user
- **A/B testing:** Test UI changes with subsets of users
- **Cloud sync integration:** Same identity layer powers settings synchronization

---

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | February 2026 | Initial draft |

---

*End of Design Document*
