# ADR-007: Monarch Money Session Cookie Authentication

> **Status:** Accepted  
> **Updated:** 2025-05-14  
> **Author:** @meseer  

## Context

Monarch Money changed its API authentication mechanism. The previous approach used a bearer-style `Authorization: Token <value>` header, where the token was extracted from `localStorage` (`persist:root` → `user.token`). This token is now always `null`, breaking the existing authentication flow.

Investigation revealed that Monarch Money migrated to **session-based cookie authentication**:

- **`session_id`** — An HttpOnly cookie (not readable via JavaScript) that authenticates API requests
- **`csrftoken`** — A regular cookie (readable via `document.cookie`) whose value must be sent as an `x-csrftoken` header with every API request
- **`session_expires_at`** — Available in `localStorage` → `persist:root` → `user` object, providing session expiry information

## Decision

We will migrate from token-based authentication (`Authorization: Token xxx`) to session cookie authentication (`x-csrftoken` header + browser cookies), with the following design:

### Authentication Flow

1. **On `app.monarch.com`**: The userscript captures the `csrftoken` from `document.cookie` and `session_expires_at` from `localStorage`. These are stored via `GM_setValue` for cross-domain access.

2. **On other domains** (Questrade, Wealthsimple, etc.): The userscript reads the stored `csrftoken` via `GM_getValue` and includes it as the `x-csrftoken` header in API requests. The `session_id` cookie is automatically sent by `GM_xmlhttpRequest` from the browser's extension-level cookie jar.

3. **Session expiry tracking**: The `session_expires_at` value is checked before each API call with a 60-second buffer. If expired, the user is prompted to open Monarch Money to refresh the session.

4. **Periodic credential refresh**: On `app.monarch.com`, credentials are re-captured every 5 seconds to detect cookie refreshes. On other domains, a polling mechanism checks for credential updates in GM storage.

### Key Technical Details

- `GM_xmlhttpRequest` (Tampermonkey/Violentmonkey) operates at the **extension level**, automatically sending cookies from the browser's cookie jar for the target domain — including HttpOnly cookies like `session_id`
- The `csrftoken` cookie is **not** HttpOnly, so it can be read from `document.cookie` on the Monarch domain
- `GM_cookie` was not used because Violentmonkey does not support it
- On 401/403 responses, credentials are cleared to force re-authentication

### Breaking Changes

- The `Authorization: Token xxx` header is completely removed
- The `monarch_graphql_token` storage key is replaced with `monarch_csrf_token` and `monarch_session_expires_at`
- The state shape for `auth.monarch` changes from `{ token: string | null }` to `{ csrfToken: string | null; sessionExpiresAt: string | null }`
- No backward compatibility is maintained — this is a major version bump

## Consequences

### Positive

- Aligns with Monarch Money's current authentication mechanism
- Session cookies are managed by the browser, reducing manual token management
- Session expiry tracking enables proactive user notification before requests fail
- `GM_xmlhttpRequest` automatically handles HttpOnly `session_id` cookie — no special extraction needed

### Negative

- Users must have an active Monarch Money session in their browser (must be logged in)
- Cross-domain credential sharing relies on `GM_setValue`/`GM_getValue` (Tampermonkey/Violentmonkey specific)
- Session refresh requires the user to have Monarch Money open in a tab (or visit it periodically)
- Major version bump required — no backward compatibility with old token-based auth

### Risks

- If Monarch changes their CSRF token rotation policy, the 5-second polling interval may need adjustment
- If Monarch adds SameSite cookie restrictions, `GM_xmlhttpRequest` may need additional configuration
- Users who upgrade will need to log into Monarch Money to re-establish credentials

## Alternatives Considered

1. **`GM_cookie` API**: Would allow reading HttpOnly cookies directly, but only works in Tampermonkey (not Violentmonkey). Rejected for cross-extension compatibility.

2. **`fetch` with `credentials: 'include'`**: Works on `app.monarch.com` but not cross-domain from other institution sites. Rejected because the userscript needs to make API calls from multiple domains.

3. **Backward compatibility layer**: Could detect which auth method works and use the appropriate one. Rejected because the old token is always `null` — there's nothing to be backward-compatible with.