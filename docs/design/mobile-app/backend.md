# Backend — Low-Level Design

> **Status:** Draft  
> **Updated:** 2026-02-25  
> **Author:** @meseer  
> **Note:** Low-level design for the own backend service. Part of the [Mobile App Architecture](./architecture.md).

---

## 1. Overview

The backend serves as the **settings and state store** for the mobile app. In Phase 1 it does not store any financial data — that remains in Monarch Money. Its role is to hold everything that Monarch cannot: account mappings, sync configuration, deduplication state, sync history, and network allowlists. This enables multi-device support and provides the foundation for Phase 2 data ownership.

### What the Backend Is (Phase 1)
- Source of truth for all app configuration and state
- Multi-device sync hub
- Sync history and audit log
- Deduplication ledger (which transaction IDs have been uploaded)

### What the Backend Is Not (Phase 1)
- Not a proxy for financial institution API calls (those happen on-device)
- Not a financial data store (transactions/balances live in Monarch for now)
- Not a scheduler (background sync is triggered from the device, not the backend)

---

## 2. Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 20+ (TypeScript) | Maximum code reuse from existing `src/` JS modules; team familiarity |
| Framework | Fastify | Fast, schema-driven, TypeScript-first; less boilerplate than Express |
| Database | PostgreSQL | Relational model fits account mappings and config; Supabase provides managed Postgres + auth + realtime |
| Auth | Supabase Auth | JWT-based, supports MFA, handles user accounts for the app itself |
| Hosting (Phase 1) | Supabase | Manages DB + auth + hosting; free tier covers personal/small scale |
| Hosting (Phase 2) | Fly.io | More control, easy to migrate from Supabase; supports persistent volumes for Postgres |
| Realtime sync | Supabase Realtime | Postgres change notifications pushed to all devices via WebSocket — enables instant multi-device sync |

---

## 3. API Design

### 3.1 Authentication

All endpoints require a valid JWT issued by Supabase Auth, passed as `Authorization: Bearer <jwt>`.

The mobile app authenticates its own users (separate from financial institution auth) using email + password, or OAuth (Google/Apple Sign In). This JWT identifies the app user across devices.

### 3.2 REST Endpoint Surface (Phase 1)

```
POST   /auth/signup                  — Create app user account
POST   /auth/login                   — Login, receive JWT
POST   /auth/refresh                 — Refresh JWT

GET    /settings                     — Get all settings for current user
PUT    /settings                     — Replace all settings (full sync from device)
PATCH  /settings                     — Partial update

GET    /integrations                 — List configured integrations + status
GET    /integrations/:id             — Get single integration config
PUT    /integrations/:id             — Save integration config (auth status, settings)
DELETE /integrations/:id             — Remove integration

GET    /integrations/:id/accounts    — List account mappings for integration
PUT    /integrations/:id/accounts    — Replace all account mappings
PATCH  /integrations/:id/accounts/:accountId — Update single account mapping

GET    /integrations/:id/dedup       — Get uploaded transaction IDs for deduplication
POST   /integrations/:id/dedup       — Append newly uploaded transaction IDs
DELETE /integrations/:id/dedup       — Prune old entries (by date threshold)

GET    /sync-history                 — Get sync log entries (paginated)
POST   /sync-history                 — Append a sync log entry

GET    /network-allowlist            — Get user's network allowlist
PUT    /network-allowlist            — Replace network allowlist
```

### 3.3 Sync Semantics

The mobile app treats the backend as the **authoritative source** for settings. On startup, it fetches the full settings payload and merges with any local changes made while offline. Conflict resolution is **last-write-wins** at the field level, with timestamps on each settings section.

Supabase Realtime subscriptions allow a second device to receive settings changes instantly when another device modifies them.

---

## 4. Data Model

### 4.1 Users Table (managed by Supabase Auth)
Standard Supabase `auth.users` table. No custom columns needed in Phase 1.

### 4.2 `user_settings` Table

```sql
CREATE TABLE user_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  network_allowlist  JSONB NOT NULL DEFAULT '{"wifi": [], "cellular": true}',
  ui_preferences     JSONB NOT NULL DEFAULT '{}',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
```

### 4.3 `integrations` Table

```sql
CREATE TABLE integrations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id VARCHAR(50) NOT NULL,  -- 'questrade', 'wealthsimple', etc.
  enabled        BOOLEAN NOT NULL DEFAULT true,
  auth_status    VARCHAR(20) NOT NULL DEFAULT 'unauthenticated',
                 -- 'authenticated' | 'unauthenticated' | 'needs_2fa'
  config         JSONB NOT NULL DEFAULT '{}',
                 -- lookback_days, category_mappings, holdings_mappings, etc.
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, integration_id)
);
```

The `config` JSONB column stores all integration-specific settings that currently live in `GM_setValue` keys. Example structure for Wealthsimple:

```json
{
  "lookbackDays": 30,
  "categoryMappings": { "GROCERIES": "uuid-123", "DINING": "uuid-456" },
  "holdingsMappings": {}
}
```

### 4.4 `account_mappings` Table

```sql
CREATE TABLE account_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id    VARCHAR(50) NOT NULL,
  institution_account_id   VARCHAR(200) NOT NULL,
  institution_account_data JSONB NOT NULL DEFAULT '{}',
                    -- nickname, type, subtype, last balance, etc.
  monarch_account_id       VARCHAR(200),
  monarch_account_data     JSONB NOT NULL DEFAULT '{}',
                    -- displayName, type
  sync_enabled      BOOLEAN NOT NULL DEFAULT true,
  last_sync_date    DATE,
  account_settings  JSONB NOT NULL DEFAULT '{}',
                    -- storeTransactionDetailsInNotes, invertBalance, etc.
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, integration_id, institution_account_id)
);
```

### 4.5 `uploaded_transactions` Table (Deduplication Ledger)

```sql
CREATE TABLE uploaded_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id    VARCHAR(50) NOT NULL,
  institution_account_id   VARCHAR(200) NOT NULL,
  transaction_id    VARCHAR(500) NOT NULL,
  transaction_date  DATE NOT NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, integration_id, institution_account_id, transaction_id)
);

-- Index for fast dedup lookups
CREATE INDEX idx_uploaded_tx_lookup
  ON uploaded_transactions (user_id, integration_id, institution_account_id, transaction_date DESC);

-- Automatic pruning: entries older than 120 days are irrelevant
-- (handled by a scheduled Postgres job or app-level cleanup on sync)
```

### 4.6 `sync_history` Table

```sql
CREATE TABLE sync_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  integration_id  VARCHAR(50) NOT NULL,
  account_id      VARCHAR(200),
  sync_type       VARCHAR(20) NOT NULL,  -- 'manual' | 'background'
  status          VARCHAR(20) NOT NULL,  -- 'success' | 'partial' | 'failed' | 'skipped'
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  transactions_uploaded  INTEGER,
  balances_uploaded      INTEGER,
  error_message   TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'
);

-- Retention: keep last 90 days of history
CREATE INDEX idx_sync_history_user_time
  ON sync_history (user_id, started_at DESC);
```

---

## 5. Row-Level Security (RLS)

All tables use Supabase Row Level Security to ensure users can only access their own data:

```sql
-- Example for account_mappings (same pattern for all tables)
ALTER TABLE account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can only access their own account mappings"
  ON account_mappings
  FOR ALL
  USING (auth.uid() = user_id);
```

---

## 6. Multi-Device Sync

### 6.1 Strategy

The backend is the single source of truth. Devices are clients that read from and write to it. There is no peer-to-peer sync.

**On app startup / foreground:**
1. Fetch current settings + account mappings from backend
2. If local changes were made while offline, push them to backend (last-write-wins per field)
3. Subscribe to Supabase Realtime channel for this user's data

**On settings change (any device):**
1. Write change to backend immediately
2. Supabase Realtime broadcasts the change to all other connected devices
3. Other devices update their local state

### 6.2 Offline Support

The app caches the last known backend state in `AsyncStorage`. If the network is unavailable:
- The app continues to work with cached settings
- Changes are queued locally with timestamps
- On next network availability, queued changes are pushed to the backend

---

## 7. Code Reuse from Existing `src/`

The backend imports directly from the existing `src/` modules where they are pure logic:

```
backend/
├── src/
│   ├── routes/           # Fastify route handlers
│   ├── services/         # Backend-specific business logic
│   └── shared/           # Symlink or copy of monarch-uploader/src/
│       ├── mappers/      # src/mappers/ — reused as-is
│       ├── services/     # src/services/ — reused (minus UI imports)
│       └── api/          # src/api/ — reused (fetch works in Node 18+)
```

The `httpClient.js` in the shared layer uses `fetch` natively (Node 18+ has built-in fetch). The `storageAdapter.js` is replaced with direct database queries in the backend context.

---

## 8. Phase 2 — Own Financial Data Storage

When the backend grows to store financial data directly, the following tables are added:

```sql
-- Transactions (mirrors Monarch's transaction model)
CREATE TABLE transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  account_id      UUID NOT NULL REFERENCES account_mappings(id),
  external_id     VARCHAR(500),  -- institution's transaction ID
  date            DATE NOT NULL,
  amount          DECIMAL(15, 2) NOT NULL,
  merchant_name   VARCHAR(500),
  category        VARCHAR(200),
  notes           TEXT,
  pending         BOOLEAN NOT NULL DEFAULT false,
  metadata        JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Balance history
CREATE TABLE balance_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id),
  account_id  UUID NOT NULL REFERENCES account_mappings(id),
  date        DATE NOT NULL,
  balance     DECIMAL(15, 2) NOT NULL,
  currency    CHAR(3) NOT NULL DEFAULT 'CAD',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (account_id, date)
);

-- Holdings (investment positions)
CREATE TABLE holdings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES auth.users(id),
  account_id      UUID NOT NULL REFERENCES account_mappings(id),
  symbol          VARCHAR(20),
  description     VARCHAR(500),
  quantity        DECIMAL(20, 8),
  market_value    DECIMAL(15, 2),
  cost_basis      DECIMAL(15, 2),
  currency        CHAR(3) NOT NULL DEFAULT 'CAD',
  as_of_date      DATE NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

In Phase 2, Monarch becomes one of several optional "sinks" — the app can write to Monarch, to the own backend, or both.

---

## 9. Related Documents

- [Architecture — High-Level Design](./architecture.md)
- [WebView Auth — Low-Level Design](./webview-auth.md)