---
name: add-integration
description: Add or review a financial institution integration in monarch-uploader using the modular integration architecture (`src/integrations/<name>/`). Triggers when implementing support for a new bank/institution, porting a contributor PR for a new institution, or updating an integration's auth, account discovery, transaction pagination, or UI injection.
---

# Add a Financial Institution Integration

Before writing any code, read [`docs/runbooks/adding-a-new-integration.md`](../../../docs/runbooks/adding-a-new-integration.md) in full. It is the canonical step-by-step reference for both humans and AI agents. Also inspect existing modular integrations (`src/integrations/mbna/`, `src/integrations/pcfinancial/`, `src/integrations/neo/`) as working templates.

## Non-negotiable architectural rules

1. **Self-contained modular directory**: Every new integration lives in `src/integrations/<name>/` (`manifest.ts`, `source/auth.ts`, `source/api.ts`, `source/injectionPoint.ts`, `sinks/monarch/syncHooks.ts`, `sinks/monarch/index.ts`, `index.ts`) and is registered in `src/integrations/index.ts` and `src/userscript-metadata.cjs`.
2. **Never touch legacy maps**: Do **NOT** add entries to `src/core/config.ts`, `src/core/integrationCapabilities.ts`, `src/services/common/accountService.ts`, `src/services/common/configStore.ts`, `src/index.ts`, or `src/ui/components/settingsModal.ts`.
3. **Deterministic backend APIs over DOM scraping**: Always discover accounts, card numbers, balances, credit limits, `dateOpened`, and transactions via backend JSON/GraphQL endpoints. Treat DOM scraping or passive traffic sniffing for account discovery as a strict last resort when no backend endpoint exists.
4. **Credentials are never stored ([ADR-010](../../../docs/decisions/010-credentials-are-never-stored.md))**:
   - Check auth mechanisms in order of simplicity:
     1. **Approach A**: `HttpOnly` cookies forwarded automatically by the browser (`MBNA`, `Neo`).
     2. **Approach B**: Read tokens/CSRF values on demand from `window.sessionStorage`, `window.localStorage`, or `document.cookie` (`PC Financial`, `Questrade`, `Wealthsimple`, `Canada Life`).
     3. **Approach C**: Capture request headers in memory via network hooks (`Rogers Bank`) — only when values do not exist anywhere in cookies or Web Storage.
   - Never write credentials to `GM_setValue`, `{id}_config`, `localStorage`, `sessionStorage`, or logs. `test/guards/noStoredCredentials.test.js` enforces this.
5. **Minimize headers by elimination**: Bank SPAs attach many non-essential headers (fingerprints, marketing IDs, analytics headers). Replay a captured `curl` request and strip headers one by one to find the minimal required set before coding `api.ts`.

## Collaborative workflow with the user

Adding an integration involves live testing against a real bank session. Follow this sequence:

### Phase 1: Discovery & API verification
1. Gather sample requests/responses (from DevTools Network/Application tabs, `curl` commands, HAR exports, or an existing contributor PR).
2. Identify:
   - Where auth/CSRF tokens live (`HttpOnly` cookies vs. `sessionStorage` / `localStorage` keys).
   - Minimal required request headers (via `curl` header elimination if possible) and whether any per-request nonce/verifier needs a retry on transient errors.
   - Deterministic endpoints for account list/config, card list, account details (`balance`, `creditLimit`, `dateOpened`), and posted/pending transactions.
   - Transaction pagination mechanism and sign convention (Monarch convention: charges = negative, payments/deposits = positive). Add a late-posting buffer (e.g., 7 days before `fromDate`) when stopping reverse-chronological cursor pagination early.
   - Dashboard DOM injection target selector and native card CSS (`border-radius`, `border`, `background`, `box-shadow`, `padding`).

### Phase 2: Implementation & local build (pause before pushing)
1. Create a feature branch (`feat/<institution>`).
2. Implement `src/integrations/<name>/`, register in `src/integrations/index.ts`, update `src/userscript-metadata.cjs` (`@match`, `@connect`, `@description`), update `README.md`, and bump the major version (`npm run version:bump -- X.0.0`).
3. Add unit tests in `test/integrations/<name>/` (`manifest.test.js`, `auth.test.js`, `api.test.js`, `syncHooks.test.js`).
4. Run `npm run build:full` so `dist/monarch-uploader.user.js` is built and validated.
5. **Pause before pushing** when the user wants to test the locally built `dist/monarch-uploader.user.js` against their live account.

### Phase 3: Live testing & UI/branding polish
During live testing with the user, verify and refine:
- **Account creation & types**: If the institution has multiple account types (e.g. depository + credit card), verify `accountDefaultsForAccount(account)` maps each account to the right Monarch type/subtype and `invertBalance` default.
- **Initial sync start date**: Verify `suggestStartDate(api, accountId)` defaults to the account's open date (`dateOpened`) or earliest statement date rather than the generic 90-day fallback.
- **Monarch account logo (`logoCloudinaryId`)**: If `logoCloudinaryId` is `null`, the user can upload the institution's logo in Monarch Money and share the `Common_SetAccountLogo` GraphQL payload (`variables.input.cloudinaryPublicId`) so you can set `logoCloudinaryId` in `manifest.ts`.
- **Card injection & styling**: Adjust `injectionPoint.ts` selectors and `containerStyle` + `manifest.brandColor` so the injected uploader card blends naturally into the dashboard without duplicate initialization on SPA navigation.

### Phase 4: Ship
Once live testing passes, run `.claude/skills/ship-pr/SKILL.md` (`npm run build:full` → commit → push → PR → `gh pr checks --watch --fail-fast` → `gh pr merge --squash --delete-branch` → pull `main`). If superseding a contributor PR, preserve `Co-authored-by:` credit in the commit and PR body.
