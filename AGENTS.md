# Project Rules

> This file configures AI coding agent behavior for the monarch-uploader project.
> It consolidates all project conventions and mandatory guidelines. `CLAUDE.md`
> only imports this file — edit conventions here.

## Table of Contents

1. [Versioning Guidelines](#versioning-guidelines)
2. [Build Validation](#build-validation)
3. [Test Coverage Requirements](#test-coverage-requirements)
4. [Project Structure](#project-structure)
5. [Code Style](#code-style)
6. [Separation of Concerns](#separation-of-concerns)
7. [Error Handling](#error-handling)
8. [Module Dependencies and Imports](#module-dependencies-and-imports)
9. [HTML Element ID Guidelines](#html-element-id-guidelines)
10. [Git Workflow](#git-workflow)
11. [Integration Consistency](#integration-consistency)
12. [File Size Limits](#file-size-limits)
13. [Documentation](#documentation)

---

## Versioning Guidelines

### How to Update the Version

**Run the version bump script** — it updates all required locations automatically:

```bash
npm run version:bump -- X.Y.Z
```

This single command updates:
- `package.json` → `"version": "X.Y.Z"`
- `src/scriptInfo.json` → `"version": "X.Y.Z"`
- `README.md` → version badge

**Do NOT manually edit version strings in these files.** Always use the script.

The `src/userscript-metadata.cjs` reads version from `scriptInfo.json` at build time — do NOT edit it directly for version changes.

### Version Increment Rules

- **Patch** (X.Y.Z+1): Bug fixes, refactoring, docs, minor UI tweaks, test updates
- **Minor** (X.Y+1.0): New features, new UI components, new config options, new storage keys, new API integrations
- **Major** (X+1.0.0): New financial institution support, breaking API changes, new @grant permissions, major architectural changes

When in doubt, use patch. If multiple change types, use the highest impact.

### How to Determine the Current Version

```bash
node -p "require('./src/scriptInfo.json').version"
```

See `VERSIONING.md` for full details and examples.

---

## Build Validation

### Mandatory Build Check

**You MUST run this before marking any task as complete:**

```bash
npm run build:full
```

This single command runs: clean → lint → typecheck → test → webpack production build.

All steps must complete with **zero errors**. Fix warnings even when the build
succeeds — the only expected warnings are webpack's bundle-size notices.

If it fails, fix the root cause and re-run.

### Individual Commands (for targeted debugging)

| Command | Purpose |
|---------|---------|
| `npm run lint` | ESLint checks (`npm run lint:fix` for auto-fixable issues) |
| `npm run typecheck` | TypeScript type checking (`tsc --noEmit`) |
| `npm test` | Jest test suite |
| `npm run build` | Production webpack build only |
| `npm run build:full` | All of the above in sequence |

---

## Test Coverage Requirements

### Mandatory Test Coverage

- **New functions/methods**: Must have tests covering happy paths, error scenarios, and edge cases
- **Modified code**: Update existing tests to reflect new behavior; add regression tests for bug fixes
- **New UI components, services, API integrations, utilities**: All require test coverage

### Test File Locations

Tests are `.js` files (not yet migrated to TypeScript). Source is `.ts`.

| Source Location | Test Location |
|----------------|--------------|
| `src/api/*.ts` | `test/api/*.test.js` |
| `src/core/*.ts` | `test/core/*.test.js` |
| `src/services/*.ts` | `test/services/*.test.js` |
| `src/ui/components/*.ts` | `test/ui/*.test.js` |
| `src/utils/*.ts` | `test/utils/*.test.js` |
| `src/integrations/*/` | `test/integrations/*.test.js` |

### Guidelines

- Use descriptive test names; group with `describe` blocks; follow Arrange-Act-Assert
- Mock external dependencies; use existing setup in `test/setup.js`
- Follow testing patterns established in existing test files

---

## Project Structure

### Before Making Changes

- Read `VERSIONING.md` before touching a version
- Check `README.md` for project overview and setup
- Read existing code in similar files and follow the established patterns

### Architecture

```
src/
├── api/            # API clients for external services (HTTP only)
├── core/           # Config, state, utils, integration registry
├── integrations/   # Modular integrations (manifest + source + sink)
│   └── mbna/      # Reference implementation
├── mappers/        # Data transformation utilities
├── services/       # Business logic and orchestration
├── sinks/          # Output adapters (e.g., Monarch API sink)
├── types/          # Shared TypeScript type definitions
├── ui/             # User interface components
│   ├── components/ # Reusable UI components
│   ├── generic/    # Generic integration UI components
│   └── [institution]/ # Institution-specific UI (questrade, wealthsimple, etc.)
└── utils/          # General utility functions
```

### File Organization Rules

- API clients → `src/api/`
- Business logic → `src/services/`
- Reusable UI components → `src/ui/components/`
- Utility functions → `src/utils/`
- Institution-specific UI → `src/ui/[institution]/`
- New modular integrations → `src/integrations/[name]/` (see docs/runbooks/adding-a-new-integration.md)
- Shared types → `src/types/`

### Naming Conventions

- camelCase for file names and function names
- PascalCase for class names and type/interface names
- kebab-case for CSS classes and HTML element IDs
- Test files are named `[filename].test.js` and mirror the source structure under `test/`

### UI Development

- Keep components focused and single-purpose
- Extract reusable logic into separate functions
- Use the existing UI utilities (toast, modals, progress dialog) rather than new ones
- Follow existing component patterns
- Match the project's established CSS patterns and keep styling consistent

### Checklist for New Features

- [ ] Code follows the project structure
- [ ] Tests added or updated
- [ ] Version bumped
- [ ] `npm run build:full` passes
- [ ] Documentation updated if needed
- [ ] No lint errors or warnings
- [ ] Error handling implemented

---

## Code Style

### TypeScript

- Source files use `.ts` (migration complete — 108 files)
- Use ES6+ features (arrow functions, destructuring, template literals)
- Prefer `const` over `let`, avoid `var`
- Use async/await for asynchronous operations
- Use TypeScript types/interfaces for function signatures and data shapes
- Add JSDoc comments for public functions
- Never leave `console.log` statements in production code — use `debugLog`
- Maintain backward compatibility unless the change is explicitly breaking
- Imports are relative (`../core/utils`). There are no `paths` aliases in
  `tsconfig.json`, so absolute `src/...` imports will not resolve.

### Function Length

**Soft Limit: 50 lines | Hard Limit: 100 lines**

Count only code lines — exclude comments and whitespace.

- Functions over 100 lines MUST be refactored
- If a function must exceed 50 lines, justify why in a comment
- Use early returns to flatten nesting; extract complex loop bodies
- Use options objects for functions with >5 parameters
- Destructure parameters at function entry for clarity
- Group related operations within a function using blank lines and comments

### Signs a Function Needs Splitting

- Nesting deeper than 3 levels
- More than 5 parameters
- Multiple return points that make the logic hard to follow
- Repetitive blocks that should be extracted

### Single Responsibility

One function, one job. `fetchBalanceHistory()` fetches balance data and
`processBalanceData()` converts it to CSV; a combined
`fetchAndProcessBalance()` is doing too much and should be split.

### Code Duplication

Extract when (the Rule of Three):

- Complex logic appears 3+ times, or 2+ times if it's complex business logic
- A change to one instance would always have to apply to all the others
- The logic is a clear, reusable concept with a good name

Allow duplication when:

- It's a simple expression in one or two places (e.g. `` `$${value.toFixed(2)}` ``)
- The copies have different semantics and are likely to diverge
- Extracting would make the code harder to understand than the duplication

Extraction placement:

| Shared logic | Goes in |
|---|---|
| Pure logic / helpers | `src/core/utils.ts` |
| Data transforms | `src/mappers/` |
| Configuration | `src/core/config.ts` |
| API communication | `src/api/` |
| Domain helpers used in one file only | Same file, as a local helper |

Anti-patterns:

- **Premature abstraction** — don't abstract for two uses with an unclear future
- **Unnecessary parameterization** — don't over-parameterize for speculative flexibility
- **God functions** — don't write one function that does everything behind flags;
  write separate focused functions

---

## Separation of Concerns

### Layer Responsibilities

| Layer | Location | Responsibility | Must NOT |
|-------|----------|---------------|----------|
| API | `src/api/` | HTTP communication via GM_xmlhttpRequest, add auth headers, parse JSON, handle HTTP errors, return raw data to callers | Contain business logic, touch DOM, make UI updates, manage state |
| Services | `src/services/` | Business logic, apply business rules, orchestrate API calls, data validation, coordinate between modules, handle domain-specific errors | Make HTTP requests directly, manipulate DOM |
| UI | `src/ui/` | DOM manipulation, user events, notifications, visual state, format data for display | Contain business logic, call APIs directly |
| State | `src/core/state.ts` | Centralized app state, getters/setters | Import from services, API, or UI layers |

Peer layers should minimize cross-dependencies.

### Dependency Flow

```
UI → Services → API → Core/Utils
```

Upper layers can import from lower layers. Lower layers CANNOT import from upper layers.

**Exception**: Toast notifications from service layers are acceptable, but prefer
returning a status and letting the caller handle the notification where possible.
The API layer may import auth services.

---

## Error Handling

### Core Principles

1. **Fail fast** — detect and report errors as early as possible
2. **Be specific** — provide clear, actionable error messages
3. **Propagate properly** — let errors bubble up through the layers appropriately
4. **User-friendly** — friendly messages via toast, technical detail via `debugLog`
5. **Consistent** — use the same patterns throughout

### Project-Specific Patterns

- **User-facing**: `toast.show('Friendly message', 'error')` — no technical jargon
- **Developer**: `debugLog('Technical details:', error)` — include context (accountId, endpoint, etc.)
- **Validation**: validate inputs early with guard clauses and throw descriptive errors

### Custom Error Classes

Create a custom error class only for a domain-specific error that needs special
handling — one that carries extra context, like `CanadaLifeUploadError` with its
`accountId`. For trivial validation failures, use a standard `Error`.

### Error Propagation by Layer

- **Low-level** (API, utilities): Throw errors with context
- **Mid-level** (services): Catch per-item errors in bulk operations, continue processing remaining items
- **High-level** (UI entry points): Catch all, show user-friendly toast, log technical details

### API Errors

- Handle specific HTTP status codes (401 → clear auth, 404 → resource not found, 500+ → server error)
- On 401, clear stored auth tokens and prompt re-login
- Use `GM_xmlhttpRequest` `onerror` for network failures

### Anti-patterns to Avoid

- **Swallowing errors silently** — empty catch blocks
- **Catch-and-rethrow without adding value** — pointless catch blocks
- **Vague messages** — "Something went wrong" or "Error"
- **Using errors for control flow** — use null checks instead

---

## Module Dependencies and Imports

### Dependency Hierarchy

```
UI Layer (src/ui/)
    ↓ can import
Services Layer (src/services/)
    ↓ can import
API Layer (src/api/)
    ↓ can import
Core/Utils (src/core/, src/utils/)
    ↓ can import
Config (src/core/config.ts)
```

### Quick Reference

| Import From → To | Allowed? |
|------------------|----------|
| UI → Services | Yes |
| UI → API | No — use services |
| Services → API | Yes |
| Services → Services | Minimize — extract to utils |
| API → Services | No (except auth) |
| API → UI | Never |
| Utils → Services | Never |
| Anywhere → Utils/Config/State | Yes |

### Import Organization

Order imports with blank lines between groups:
1. External packages
2. Core modules (config, state, utils)
3. API clients
4. Services
5. UI components
6. Relative imports from same directory

### Export Conventions

- **Named exports** for utility functions and multiple exports per file
- **Default exports** for single primary exports, services, and components

### Preventing Circular Dependencies

- Extract shared logic to a lower-layer module
- Use dependency injection (pass dependencies as parameters) when needed

---

## HTML Element ID Guidelines

**ALWAYS add meaningful IDs to HTML elements created in JavaScript.** IDs improve
testability, debugging, maintainability, and accessibility.

### When to Add IDs

All modal overlays, interactive elements (buttons, inputs, selects), containers with dynamic content, list items, and major structural elements (headers, sections, footers).

### ID Naming Convention

Format: `kebab-case`, namespaced by component/feature:

| Element Type | Pattern | Example |
|--------------|---------|---------|
| Modal overlay | `{component}-overlay` | `security-selector-overlay` |
| Modal container | `{component}-modal` | `security-selector-modal` |
| Modal header | `{component}-header` | `security-selector-header` |
| Button | `{feature}-{action}-button` | `account-upload-button` |
| Input | `{feature}-{field}-input` | `security-search-input` |
| Container | `{feature}-{content}-container` | `search-results-container` |
| List item | `{feature}-item-{id}` | `security-item-123` |
| Item sub-element | `{feature}-{part}-{id}` | `security-name-123` |

Use unique identifiers from data for list items: `item.id = \`security-item-${security.id}\``

Not `SecuritySelectorModal` (PascalCase) and not `security_selector_modal`
(snake_case) — always kebab-case.

### Common Pitfalls

- Generic IDs: `div1`, `button`, `wrapper`
- Duplicate IDs across list items — always append a unique suffix from the data
- Skipping IDs for "simple" elements — every interactive element needs one

---

## Git Workflow

### Overview

`main` is protected by the `Protect main` ruleset. All changes must go through a
feature branch → PR → merge workflow. **You MUST manage this entire lifecycle
automatically** — do not leave manual steps for the user.

**Follow the `ship` procedure** in `.claude/skills/ship/SKILL.md` to execute this
workflow (Claude Code loads it as the `ship` skill; other agents should read the
file directly). It is the authoritative procedure and records the ruleset constraints
that gate merging: squash-only merge, the required `test (24.x)` status check,
strict up-to-date enforcement (a branch behind `main` must be updated and
re-tested), and `delete_branch_on_merge` being disabled. The summary below is
the reference; the procedure is what to follow.

### Branch Naming Examples

`feat/pending-transactions`, `fix/balance-rounding`, `refactor/extract-sync-logic`,
`docs/readme-update`, `test/holdings-edge-cases`, `chore/update-dependencies`,
`build/webpack-config`

### Workflow Steps

#### 1. Create a Feature Branch (before any changes)

```bash
git checkout main && git pull && git checkout -b <type>/<short-name>
```

#### 2. Branch Naming: `<type>/<kebab-case-description>`

| Type | When to use |
|------|-------------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `refactor/` | Code refactoring |
| `docs/` | Documentation |
| `test/` | Test additions/changes |
| `chore/` | Maintenance, deps, config |
| `build/` | Build system changes |

#### 3. After Validation Passes — Commit, Push, Create PR

```bash
git add .
git commit -m "<type>: <summary>

- Detail 1
- Detail 2"

git push origin <branch-name>
gh pr create --title "<type>: <summary>" --body "<bullet list of changes>"
```

#### 4. Wait for CI — Blocking

```bash
gh pr checks --watch --fail-fast
```

Never merge or report success while a required check is pending or failing.

#### 5. After CI Passes — Merge and Clean Up

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull && git branch
```

`gh pr merge --delete-branch` deletes the remote and local branch, but it does
not switch you to `main` or pull — the second line does that.

### Commit Message Format

```
<type>: <brief summary (max 72 chars)>

<detailed description of changes>
```

Type prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `style:`, `perf:`, `build:`, `chore:`

Rules: max 72 chars, lowercase after prefix, no trailing period, imperative mood.

### Important Rules

- **NEVER** commit directly to `main` — always use a feature branch
- **NEVER** force-push to `main`
- **ALWAYS** create the branch before making changes
- **ALWAYS** use `--squash` merge
- **ALWAYS** delete the branch after merge
- **NEVER** merge with a pending or failing required check
- If you forgot to branch, move the commit to a branch before pushing
- If unsure which type to use, default to `chore:`
- For multiple unrelated changes, use separate branches and separate PRs

---

## Integration Consistency

### Overview

Patterns for maintaining consistency across all financial institution integrations (Questrade, CanadaLife, Rogers Bank, Wealthsimple, MBNA, and future integrations).

### Consolidated Account Storage

**All integrations MUST use consolidated account storage:**

```typescript
// Storage key pattern: {integration}_accounts_list
// Structure: Array of account objects
[
  {
    [sourceAccountKey]: { id, nickname, type, ... },
    monarchAccount: { id, displayName, ... },
    syncEnabled: true,
    lastSyncDate: "2024-01-15",
    storeTransactionDetailsInNotes: false,
    transactionRetentionDays: 91,
    transactionRetentionCount: 1000,
    uploadedTransactions: [{ id: "tx-1", date: "2024-01-10" }],
    // Integrations may add their own fields, e.g. lastSyncedCreditLimit or
    // balanceCheckpoint for credit cards.
  }
]
```

Storage key examples: `wealthsimple_accounts_list`, `questrade_accounts_list`.

### Account Entry Structure Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `{source}Account` | Object | Yes | Source account data (e.g. `wealthsimpleAccount`) |
| `monarchAccount` | Object | No | Monarch account mapping (null if unmapped) |
| `syncEnabled` | Boolean | Yes | Whether sync is enabled for this account |
| `lastSyncDate` | String | No | ISO date of last successful sync |
| `uploadedTransactions` | Array | No\* | Transaction IDs for deduplication (\* required if `hasDeduplication`) |
| `storeTransactionDetailsInNotes` | Boolean | No | Per-account setting |
| `transactionRetentionDays` | Number | No | Per-account setting |
| `transactionRetentionCount` | Number | No | Per-account setting |
| `syncCount` | Number | No | Number of successful syncs (for migration tracking) |

### Integration Capabilities Configuration

**All integrations MUST be registered in `src/core/integrationCapabilities.ts`:**
- Add to `INTEGRATIONS` enum
- Add configuration to `INTEGRATION_CONFIG` with: `displayName`, `storageKeys`, `accountKeyName`, `faviconDomain`, capability flags (`hasDeduplication`, `hasTransactions`, `hasBalance`, `hasHoldings`, `hasCreditLimit`), `settings` array, and `categoryMappings` config

### Account Service Usage

**All integrations MUST use `accountService` for account operations:**
- `accountService.getAccounts(integrationId)` — get all accounts
- `accountService.getMonarchAccountMapping(integrationId, accountId)` — get Monarch mapping
- `accountService.upsertAccount(integrationId, accountData)` — save/update account
- `accountService.updateAccountInList(integrationId, accountId, fields)` — update specific fields
- `getLastUpdateDate(accountId, integrationId)` / `saveLastUploadDate(accountId, integrationId, date)` from `src/core/utils`

### Settings UI Pattern

**All integrations MUST use `createGenericAccountCards()` for settings display** in their `renderTab` function. Include lookback period section, account mappings section, and category mappings section (if enabled).

### Never Do: Legacy Storage Direct Access

- `GM_getValue(STORAGE.PREFIX + accountId)` — direct legacy access
- `monarchApi.resolveAccountMapping(...)` — for existing integrations
- Always use: `accountService.getMonarchAccountMapping(integrationId, accountId)`

### Transaction Deduplication Pattern

For integrations with `hasDeduplication: true`:
1. Get `uploadedTransactions` from account data via `accountService`
2. Filter out already-uploaded transaction IDs
3. After successful upload, append new transaction IDs with today's date
4. Save via `accountService.updateAccountInList()`

### Migration Requirements

When migrating from legacy storage to consolidated:
1. Support both read paths during migration period
2. Write only to consolidated storage
3. Track sync count via `accountService.incrementSyncCount()`
4. Clean up legacy storage after 2+ successful syncs via `accountService.cleanupLegacyStorage()`

### Modular Integration Architecture

New integrations should follow the modular pattern in `src/integrations/`:
- `manifest.ts` — declares capabilities, storage keys, account shape
- `source/` — data fetching from the institution
- `sinks/` — output adapters (e.g., writing to Monarch)

See `docs/runbooks/adding-a-new-integration.md` for the step-by-step guide and `src/integrations/mbna/` for the reference implementation.

### Checklist for Adding New Integrations

- [ ] Add to `INTEGRATIONS` enum in `integrationCapabilities.ts`
- [ ] Add configuration object in `INTEGRATION_CONFIG`
- [ ] Define all storage keys in `STORAGE` config
- [ ] Add storage key constants to `src/core/config.ts`
- [ ] Verify `accountService` supports the new integration
- [ ] Implement migration logic if needed, in `migrateFromLegacyStorage`
- [ ] Add cleanup logic in `cleanupLegacyStorage` if applicable
- [ ] Add tab definition in `createSettingsModal`
- [ ] Add a favicon to the tab button
- [ ] Implement `render{Integration}Tab` function
- [ ] Use `createGenericAccountCards` for account display
- [ ] Use `accountService.getMonarchAccountMapping()` for lookups
- [ ] Use `accountService.upsertAccount()` for saving
- [ ] Use `getLastUpdateDate()` / `saveLastUploadDate()` from `src/core/utils`
- [ ] Implement deduplication using `uploadedTransactions` array
- [ ] Add tests for capabilities, account service, upload/sync, and settings UI

### Important Notes

- **Always use capabilities** to check what an integration supports
- **Never hardcode** integration-specific logic outside capabilities
- **Test with a fresh install** to ensure nothing depends on legacy data
- **Keep backward compatibility** during migration periods

### Storage Key Naming Convention

```
{integration}_{purpose}_{suffix}

Examples:
- wealthsimple_accounts_list        # Consolidated account data
- questrade_lookback_days           # Global setting
- rogersbank_category_mappings      # Category mapping storage
```

---

## File Size Limits

**No single source or test file should exceed 1,500 lines.**

| Metric | Limit |
|--------|-------|
| Lines per file | 1,500 max |
| Recommended target | 500–800 |
| Plan for split at | 1,200+ |

### When to Check

- **Before writing a new file**, estimate its final line count. If it will exceed
  1,500 lines, plan the split before writing.
- **Before adding code** to an existing file, check its current line count. If the
  addition would push it over 1,500 lines, split first. Never add code to an
  already-oversized file without splitting.

### How to Split

- **Test files**: Group related `describe` blocks into separate files using the
  suffix pattern `featureName.category.test.js`
- **Source files**: Split by functional area; use an index file to re-export if needed
- **UI components**: Extract sub-components and helper functions into separate
  files. Each file imports only what it needs, and the main component file stays
  focused on orchestration.

### Quick Check

```bash
find src test -name "*.ts" -o -name "*.js" | xargs wc -l | sort -rn | head -20
```

---

## Documentation

### Location and Structure

All documentation lives under `docs/`. See `docs/README.md` for the full index.

| Directory | Purpose |
|-----------|---------|
| `docs/design/` | Architecture reference docs — explain *why* the system is designed this way |
| `docs/runbooks/` | Step-by-step operational guides — explain *how* to do specific tasks |
| `docs/decisions/` | Architecture Decision Records (ADRs) — immutable once accepted |

### Key Documents

- **[Modular Integration Architecture](docs/design/modular-integration-architecture.md)** — core architecture: manifest, registry, source/sink, SyncHooks
- **[Adding a New Integration](docs/runbooks/adding-a-new-integration.md)** — complete guide with incremental milestones
- **[TypeScript Migration Plan](docs/design/typescript-migration-plan.md)** — migration status and approach

### Front-Matter Block

Every document carries one, inserted directly after the H1 heading. The trailing
two spaces on each line are the markdown line breaks — keep them:

```markdown
> **Status:** Active  
> **Updated:** YYYY-MM-DD  
> **Author:** @handle  
> **Note:** optional context (omit if not needed)  
```

### Status Values

| Status | When to use |
|--------|-------------|
| `Active` | Current, authoritative, reflects the codebase |
| `Draft` | Proposed but not implemented |
| `Implemented` | Completed — kept for history, do not edit |
| `Superseded` | Replaced by a newer doc — add `**Superseded by:** [link]` |
| `Deprecated` | No longer applicable |

### Document Conventions

- **Living docs** (`Active`): edit in place and update the `Updated` date
- **Historical docs** (`Implemented`, `Superseded`): do not edit — write a new doc
  and cross-link. Rewriting them falsifies the record.
- **ADRs** (`docs/decisions/`): immutable once `Accepted`. Write a new ADR that
  supersedes the old one; never edit it. Start from `docs/decisions/000-template.md`.
- ADR numbering is sequential: `NNN-kebab-title.md`
- Update the `docs/README.md` index whenever a doc is added or its status changes
