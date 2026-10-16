# ADR-010: Credentials Are Never Stored

> **Status:** Draft  
> **Date:** 2026-10-16  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

The userscript calls each institution's API with that institution's
credentials, and Monarch's API with Monarch's. Two integrations kept bank
credentials in userscript (GM) storage: Rogers Bank before 8.0.1 and
Wealthsimple before 8.0.2.

- **Rogers Bank** stored the bearer token, device ID and the plain and encoded
  account and customer IDs: first under 7 individual `rogersbank_*` keys, later
  in `rogersbank_config.auth`.
- **Wealthsimple** stored the OAuth access token, identity ID, expiry and
  profile IDs: first under 6 individual `wealthsimple_*` keys, later in
  `wealthsimple_config.auth`.

GM storage is a poor place for a secret:

- It outlives the bank session. It survives logout, tab close and browser
  restart, and nothing deletes it when the token expires unless the script
  happens to run and notice.
- It travels. Userscript managers can export and sync script values, so a
  stored token ends up in backups, in sync storage, and in whatever the user
  attaches to a bug report.
- It goes stale. A stored copy makes the UI report "Connected" for a token the
  bank has already revoked, and it hides the real state of the session.

None of the stored values were needed. Every integration can get its
credentials from the bank page when it runs:

- Questrade reads its token from the page's `sessionStorage` when needed.
- Canada Life reads its token from the page's `localStorage` when needed.
- MBNA and Neo Financial rely on the bank's session cookies, which the browser
  sends with every request.
- Rogers Bank captures credentials from its page's own API requests and keeps
  them in memory (PR #228).
- Wealthsimple reads the non-HttpOnly `_oauth2_access_v2` cookie when needed
  (8.0.2).

Nothing stopped credentials being stored: `configStore` offered a `setAuth`
writer, the integration runbook's token example stored the token in config,
and no test checked. This ADR writes the rule down and adds a guard.

## Decision

**We will never store credentials.** Not in GM storage, not in the page's
storage, not in cookies, and not in logs.

### What counts as a credential

Anything that authenticates a request:

- auth and bearer tokens (`Authorization` headers, OAuth access and refresh tokens)
- session tokens and CSRF tokens
- request-signing headers and the keys used to compute them
- device IDs and browser fingerprints used for authentication
- account or customer IDs in an encoded form that is sent as an auth header
  (for example Rogers Bank's `AccountId` and `CustomerId` headers)

Not credentials: session expiry timestamps, non-secret status such as "a
session was seen", and plain account IDs that are used as storage keys or for
display and are not sent as auth headers. When in doubt, treat a value as a
credential.

### Allowed sources

1. **In-memory capture for the page lifetime.** A value captured from the
   bank page's own requests (or read once from the page) may be held in a
   module variable or in `stateManager` until the page unloads. A reload
   captures it again.
2. **Reading the institution's own page storage or cookies when needed.** The
   script may read the bank's `localStorage`, `sessionStorage` or non-HttpOnly
   cookies at the moment it needs a credential. It treats them as read-only:
   it never writes, refreshes or deletes the institution's values.
3. **Browser cookies sent automatically.** `GM_xmlhttpRequest` and same-origin
   `fetch` attach the browser's cookies, including HttpOnly ones the script
   cannot read. No copy is needed.

### Forbidden

- **GM storage:** `GM_setValue`, `GM.setValue`, `GM_setValues`, and the
  storage adapter's `set`, for any credential value.
- **The configStore `auth` section.** `setAuth` and `getAuth` are removed;
  only `clearAuth` remains, for the purge below. Manifest `configSchema.auth`
  lists may name non-secret state only.
- **Writing to the page's storage:** `localStorage.setItem`,
  `sessionStorage.setItem` and IndexedDB, for any value. The page's storage
  belongs to the institution.
- **Setting cookies:** `document.cookie = …`, `cookieStore.set`, `GM_cookie.set`.
- **Logging secret values,** including through `debugLog` and in error
  objects whose message can quote the secret (a `JSON.parse` error quotes its
  input). Log presence, expiry and status only.

### Purging values stored by earlier versions

Each integration that used to store credentials gets a purge function in
`src/services/common/legacyMigration.ts`, called from
`migrateAllLegacyStorage()`. That runs at every script load on every supported
site, so a user who no longer visits the bank still gets cleaned up. A purge:

- deletes only the credential items: the legacy individual keys and the
  `auth` section of `{id}_config`;
- keeps settings, category and holdings mappings and `{id}_accounts_list`;
- is idempotent, writing nothing once nothing is left;
- never creates `{id}_config` for a user who has none.

Current purges:

| Function | Deletes |
|---|---|
| `purgeStoredRogersBankCredentials()` | 7 legacy `rogersbank_*` credential keys and `rogersbank_config.auth` |
| `purgeStoredWealthsimpleAuth()` | 6 legacy `wealthsimple_*` auth keys and `wealthsimple_config.auth` |

A purge costs a few storage reads per page load. Keep it until a later
decision removes it; removing it early leaves old secrets in place for users
who upgrade late.

### Enforcement

- `AGENTS.md` carries the rule as mandatory, and the integration runbook only
  shows in-memory or on-demand credential handling.
- `configStore` has no auth writer.
- `test/guards/noStoredCredentials.test.js` parses every file under `src/`
  and fails on any write of a credential-like key or value to GM storage or
  the storage adapter, any `setAuth` or `auth`-section write, and any write to
  page storage or cookies. Its only allowlist entry is the Monarch CSRF token
  below.

## Open question: the Monarch CSRF token

This rule conflicts with [ADR-007](007-monarch-session-cookie-auth.md)
(Accepted). ADR-007 stores Monarch's `csrftoken` in GM storage
(`monarch_csrf_token`) on purpose: the script captures it on app.monarch.com
and needs it on the bank sites, where it is sent as the `x-csrftoken` header.
GM storage is the only channel the script has between the two origins.
`monarch_session_expires_at` is stored too, but it is not a credential.

This ADR does not change Monarch auth and does not amend ADR-007. Until the
question below is decided, the guard allowlists exactly the
`STORAGE.MONARCH_CSRF_TOKEN` writes in `src/services/auth.ts`, and nothing
else.

What limits the exposure today: the CSRF token does not authenticate on its
own. Monarch also requires the HttpOnly `session_id` cookie, which stays in the
browser's cookie jar and is never copied. A stored CSRF token is still a
long-lived secret in GM storage, and so in exports and sync.

Options:

| Option | How it works | Trade-offs |
|---|---|---|
| **A. Keep a scoped, documented exception** | Keep ADR-007 as is. Optionally tighten it: delete the token once `session_expires_at` passes, as well as on 401/403. | No behaviour change, works in every userscript manager. The rule keeps one exception, and the token stays in GM storage for as long as the Monarch session lasts. |
| **B. Read the cookie with `GM_cookie`** | On a bank page, call `GM_cookie.list` for monarch.com when a Monarch request is about to be made; hold the value in memory. | Nothing stored. Needs a new `@grant GM_cookie`, which AGENTS.md treats as a major version. Tampermonkey only: ADR-007 rejected it because Violentmonkey does not support it, and its availability in Tampermonkey varies by version and needs checking. Violentmonkey users would still need option A, so the exception would not go away. |
| **C. Fetch a fresh token from Monarch** | On a bank page, have `GM_xmlhttpRequest` call a Monarch endpoint (the browser attaches the Monarch cookies) and take the token from the response; hold it in memory. | Nothing stored, no new grant, works in both managers. It is not known that any Monarch endpoint returns the token: browsers hide `Set-Cookie` from XHR and fetch, whether `GM_xmlhttpRequest` exposes it varies by manager, and the web app is a single-page app, so its HTML may not embed one. Needs a probe first (see the method in [ADR-009](009-monarch-pending-field-is-read-only.md)), costs an extra request per page, and could break silently if Monarch changes. |
| **D. Hand the token over from a Monarch window** | When a bank page needs Monarch, open app.monarch.com in a popup; the script there reads the cookie and `postMessage`s it to the opener; the bank page keeps it in memory. | Nothing stored. A popup per page load or per sync, popup blockers, and a worse user experience. The message is dispatched on the bank page's window, so the bank's own scripts can read it; that is a new exposure. |

**Decision needed from @meseer:** keep the exception (A, possibly tightened),
or invest in removing it (C first, since it is the only option that could work
in both managers; B as a Tampermonkey-only improvement). Whatever is chosen
goes in a new ADR that supersedes ADR-007 if Monarch auth changes. That ADR
also updates the guard's allowlist: tighten the entry, or delete it.

## Consequences

### Positive

- No bank credential sits in GM storage, exports, sync or bug-report dumps.
- The UI reflects the real session: a revoked or expired token shows as such.
- A regression fails the test suite instead of shipping.

### Negative / Trade-offs

- Each page load starts without credentials. Rogers Bank shows "waiting" until
  the page makes its own API request; on other sites the settings modal shows
  Rogers Bank and Wealthsimple as not connected.
- Purge code stays in `legacyMigration.ts` and runs at every load.
- The guard is a heuristic. A key assembled at run time from innocuous parts
  can get past it, so review still matters.
- New integrations cannot "remember" a login between page loads.

### Neutral

- ADR-007 stays Accepted and unchanged. The Monarch question above needs its
  own decision.
- Once the purges have had time to run for existing users, the legacy key
  constants and purge functions can be removed in a later change.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Store credentials encrypted in GM storage | The key would have to ship in the same script, so it is obfuscation, not protection. Stale copies remain. |
| Store credentials with a time-to-live | Still stored, still exported and synced, and the TTL guesses at a session lifetime the bank controls. |
| A written policy without an automated guard | Stored credentials went unnoticed while nothing checked for them. A guard keeps the rule from depending on review alone. |
| An ESLint rule instead of a test | Workable, but the test can resolve `STORAGE.*` constants to their key strings, check that its allowlist is still needed, and carry its own fixture tests. |
