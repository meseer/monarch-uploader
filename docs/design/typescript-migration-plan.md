# TypeScript Migration Plan

> **Status:** Draft  
> **Updated:** 2026-03-07 (Phase 11 in progress)  
> **Author:** @meseer  
> **Note:** See [ADR-005](../decisions/005-typescript-migration.md) for the decision record.

## Progress Tracker

| Phase | Description | Status | Files Converted |
|-------|-------------|--------|-----------------|
| 0 | Infrastructure Setup | ✅ Complete | 0 src / 0 test |
| 1 | Type Foundation | ✅ Complete | 2 src / 0 test |
| 2 | Core Layer | ✅ Complete | 8/8 src / 0 test |
| 3 | Mappers & Utils | ✅ Complete | 5/5 src / 0 test |
| 4 | MBNA Integration | ✅ Complete | 12/12 src / 0 test |
| 5 | API Layer | ✅ Complete | 9/9 src / 0 test |
| 6 | Common Services Foundation | ✅ Complete | 12/12 src / 0 test |
| 7 | CanadaLife Services | ✅ Complete | 3/3 src / 0 test |
| 8 | Rogers Bank Services | ✅ Complete | 2/2 src / 0 test |
| 9 | Questrade Services | ✅ Complete | 8/8 src / 0 test |
| 10 | WS Transaction Rules | ✅ Complete | 3/3 src / 0 test |
| 11 | WS Core Services | 🔄 In Progress | 0/5 src / 0 test |
| 12 | WS Top-Level Services | ⬜ Not Started | 0/3 src / 0 test |
| 13 | UI Layer | ⬜ Not Started | 0/32 src / 0 test |
| 14 | Strictness Ramp-up | ⬜ Not Started | — |

**Overall:** 64/106 source files converted (~60%)

## Overview

Migrate the monarch-uploader codebase from JavaScript (with JSDoc type annotations) to TypeScript. The project currently has **106 source files (~52,300 lines)** and **92 test files (~61,600 lines)** across a well-structured layered architecture.

## Current State

### Codebase Inventory

| Layer | Files | Lines | Largest File |
|-------|-------|-------|-------------|
| UI (`src/ui/`) | 32 | ~12,000 | accountSelectorWithCreate.js (1,372) |
| Services (`src/services/`) | 36 | ~18,000 | canadalife-upload.js (1,359) |
| Integrations (`src/integrations/`) | 14 | ~3,500 | Newest modular architecture |
| API (`src/api/`) | 9 | ~7,500 | wealthsimpleQueries.js (1,676) |
| Core (`src/core/`) | 8 | ~5,000 | utils.js (914) |
| Mappers (`src/mappers/`) | 3 | ~1,500 | Category/merchant mapping |
| Utils (`src/utils/`) | 2 | ~800 | CSV, transaction storage |
| Other (index, metadata, scriptInfo) | 2 | ~200 | Entry point, build metadata |
| **Tests** | **92** | **~61,600** | Mirror of source structure |

### Existing Type System

The project already has a significant JSDoc type system:

- `src/integrations/types.js` — ~310 lines of `@typedef` definitions (IntegrationManifest, IntegrationApi, SyncHooks, all callback types)
- `src/sinks/types.js` — ~130 lines of `@typedef` definitions (DataSink, SinkAccount, SinkHolding, etc.)
- `src/core/httpClient.js` — `@typedef` for HttpClient, HttpRequestOptions, HttpResponse
- `src/core/storageAdapter.js` — `@typedef` for StorageAdapter

These JSDoc types map almost 1:1 to TypeScript interfaces, making conversion largely mechanical.

### Build Toolchain

| Tool | Current | Purpose |
|------|---------|---------|
| Webpack 5 | `webpack.config.cjs` | Bundle to single `.user.js` file |
| Babel | `.babelrc` with `@babel/preset-env` | ES6+ transpilation, browser targeting |
| ESLint 10 | `eslint.config.mjs` with ~80 rules | Code quality |
| Jest 30 | `jest.config.cjs` with jsdom | Testing |
| c8 | Via `test:coverage` script | Code coverage |

---

## Compilation Strategy

### Recommended: Babel + `@babel/preset-typescript`

Keep the existing Babel pipeline and add TypeScript support as a preset. TypeScript is used only for type-checking (`tsc --noEmit`), not for compilation.

| Approach | Pros | Cons |
|----------|------|------|
| **Babel + `@babel/preset-typescript`** ✅ | Minimal webpack change, keep browser targeting, incremental migration | No `const enum`, no namespace merging |
| `ts-loader` only | Single compiler | Lose granular browser targeting, bigger migration surface |

**Rationale:** Option A minimizes risk during migration. The features lost (`const enum`, namespace merging) are not needed by this project. Can re-evaluate once migration is complete.

---

## Migration Phases

### Phase 0: Infrastructure Setup (1–2 days)

Set up TypeScript tooling without converting any source files.

**New dependencies:**
```
typescript
@babel/preset-typescript
@types/jest
@types/tampermonkey
ts-jest (or babel-jest with TS support)
typescript-eslint
```

**Config changes:**

| File | Change |
|------|--------|
| `tsconfig.json` | **New** — `strict: false`, `allowJs: true`, `checkJs: false`, `noEmit: true` |
| `webpack.config.cjs` | Resolve `.ts` extensions, add TS to babel-loader test pattern |
| `.babelrc` | Add `@babel/preset-typescript` |
| `eslint.config.mjs` | Add `typescript-eslint` parser + rules |
| `jest.config.cjs` | Add `.ts` to transforms and moduleFileExtensions |
| `package.json` | Add `typecheck` script: `tsc --noEmit` |

**Validation:** Build still works with zero `.ts` files. All existing tests pass.

### Phase 1: Type Foundation (1–2 days)

Convert type-only files from JSDoc `@typedef` to native TypeScript interfaces.

**Files to convert:**
- `src/integrations/types.js` → `src/integrations/types.ts`
- `src/sinks/types.js` → `src/sinks/types.ts`
- Create `src/types/` directory for shared types:
  - `src/types/tampermonkey.d.ts` — GM_* augmentations (or rely on `@types/tampermonkey`)
  - `src/types/accounts.ts` — shared account types
  - `src/types/transactions.ts` — shared transaction types

### Phase 2: Core Layer (3–5 days)

Convert the foundation that everything else imports from.

**Files (8):**
- `src/core/config.js` — constants, enums (high value: config keys become string enums)
- `src/core/state.js` — centralized state
- `src/core/utils.js` — utility functions (914 lines)
- `src/core/httpClient.js` — already has JSDoc types
- `src/core/storageAdapter.js` — already has JSDoc types
- `src/core/integrationCapabilities.js` — INTEGRATIONS enum, capabilities
- `src/core/integrationRegistry.js` — registry pattern
- `src/core/navigation.js` — URL/routing

**Tests:** ~12 corresponding test files.

### Phase 3: Mappers & Utils (1–2 days)

Small, pure-function files with high type-safety value.

**Files (5):**
- `src/mappers/category.js`
- `src/mappers/merchant.js`
- `src/mappers/wealthsimple-account-types.js`
- `src/utils/csv.js`
- `src/utils/transactionStorage.js`

**Tests:** ~4 corresponding test files.

### Phase 4: MBNA Integration (2–3 days)

Convert the reference integration early to establish TypeScript patterns for all future integrations.

**Files (12):**

| File | Description |
|------|-------------|
| `src/integrations/mbna/manifest.js` | Integration manifest |
| `src/integrations/mbna/index.js` | Barrel export |
| `src/integrations/mbna/source/api.js` | API client |
| `src/integrations/mbna/source/auth.js` | Auth handler |
| `src/integrations/mbna/source/injectionPoint.js` | UI injection config |
| `src/integrations/mbna/source/balanceReconstruction.js` | Balance logic |
| `src/integrations/mbna/sinks/monarch/index.js` | Monarch sink barrel |
| `src/integrations/mbna/sinks/monarch/csvFormatter.js` | CSV generation |
| `src/integrations/mbna/sinks/monarch/balanceFormatter.js` | Balance formatting |
| `src/integrations/mbna/sinks/monarch/transactions.js` | Transaction processing |
| `src/integrations/mbna/sinks/monarch/pendingTransactions.js` | Pending tx handling |
| `src/integrations/mbna/sinks/monarch/syncHooks.js` | SyncHooks implementation |

**External dependencies still in JS at this point (need `.d.ts` stubs):**
- `src/services/common/configStore.js` — getCategoryMapping, setCategoryMapping
- `src/services/common/accountService.js` — accountService default export
- `src/api/monarch.js` — monarchApi default export
- `src/ui/components/categorySelector.js` — showMonarchCategorySelector

These 4 files are heavily used across the codebase and are good candidates for early conversion instead of stubs.

**Tests:** ~8 corresponding test files.

### Phase 5: API Layer (3–5 days)

Highest-value phase — API response shapes are where most runtime bugs originate.

**Files (9):**
- `src/api/canadalife.js` (1,043 lines)
- `src/api/monarch.js` (977 lines)
- `src/api/monarchAccounts.js` (988 lines)
- `src/api/monarchTransactions.js`
- `src/api/questrade.js`
- `src/api/rogersbank.js`
- `src/api/wealthsimple.js` (1,040 lines)
- `src/api/wealthsimplePositions.js`
- `src/api/wealthsimpleQueries.js` (1,676 lines — mostly GraphQL query strings)

**Key task:** Define response types for each external API (Wealthsimple, Questrade, Monarch, CanadaLife, Rogers Bank).

**Tests:** ~10 corresponding test files.

### Phase 6: Common Services Foundation (2–3 days)

Shared infrastructure all institution services depend on. Three batches.

**Batch A — Leaves (5 files, ~1,233 lines):**
- `src/services/auth.js` (111) — core only
- `src/services/common/configStore.js` (398) — core only
- `src/services/common/legacyMigration.js` (217) — core only
- `src/services/common/pendingReconciliation.js` (396) — api/monarch, core
- `src/services/canadalife/csvFormatter.js` (90) — core, utils/csv

**Batch B — accountService cluster (6 files, ~1,830 lines):**
- `src/services/common/accountService.js` (1,170) — core only
- `src/services/common/deduplication.js` (99) — accountService
- `src/services/common/balanceUpload.js` (265) — accountService, api/monarch
- `src/services/common/creditLimitSync.js` (61) — accountService, api/monarch
- `src/services/common/transactionUpload.js` (107) — accountService, api/monarch
- `src/services/common/accountMappingResolver.js` (128) — accountService, api/monarch, ui/*

**Batch C — syncOrchestrator (1 file, 682 lines):**
- `src/services/common/syncOrchestrator.js` — depends on Batch B files + ui/*

**Tests:** ~10 corresponding test files.

### Phase 7: CanadaLife Services (1–2 days)

**Files (3, ~1,938 lines):**
- `src/services/canadalife/transactions.js` (393) — api/canadalife, core
- `src/services/canadalife/pendingReconciliation.js` (186) — common/pendingReconciliation, CL/transactions
- `src/services/canadalife-upload.js` (1,359) — api/*, core/*, ui/*, common/accountService

### Phase 8: Rogers Bank Services (1 day)

**Files (2, ~1,507 lines):**
- `src/services/rogersbank/pendingTransactions.js` (467) — api/monarch, core
- `src/services/rogersbank-upload.js` (1,040) — api/*, core/*, mappers/*, ui/*, common/accountService

### Phase 9: Questrade Services ✅ Complete

**Batch A (4 files):** auth.ts, transactionRules.ts, accountMapping.ts, account.ts  
**Batch B (4 files):** transactions.ts, balance.ts, positions.ts, sync.ts

### Phase 10: WS Transaction Rules ✅ Complete

**Files (3):** transactionRulesHelpers.ts, transactionRulesInvestment.ts, transactionRules.ts  
Added full `WealthsimpleTransaction` interface, `ExtendedOrder`, `SpendDetails`, and other shared types to `transactionRulesHelpers.ts`.

### Phase 11: WS Core Services (2–3 days)

**Batch A (3 files, ~1,626 lines):** transactionsReconciliation, transactionsHelpers, balance
**Batch B (2 files, ~1,846 lines):** transactionsInvestment, transactions

### Phase 12: WS Top-Level Services (1–2 days)

**Files (3, ~2,891 lines):** positions, account, wealthsimple-upload

### Phase 13: UI Layer (5–8 days)

Hardest layer to type — framework-less DOM manipulation.

**Files (32):**
- `src/ui/components/*.js` (~12 files — settings modal, category selector, progress dialog, etc.)
- `src/ui/canadalife/*.js` (~5 files)
- `src/ui/modals/*.js`
- `src/ui/questrade/*.js`
- `src/ui/rogersbank/*.js`
- `src/ui/wealthsimple/*.js`
- `src/ui/generic/*.js`
- `src/ui/theme.js`, `src/ui/toast.js`, `src/ui/keyboardNavigation.js`

**Key challenge:** Heavy `document.createElement` chains, event handlers, dynamic element properties. Consider creating helper types for component patterns (e.g., `UIComponent`, `ModalConfig`).

**Tests:** ~18 corresponding test files.

### Phase 14: Strictness Ramp-up (2–3 days)

Enable full strict mode once all files are `.ts`.

**Steps:**
1. Enable `strict: true` in `tsconfig.json`
2. Fix all `any` types and implicit anys
3. Enable `strictNullChecks` — add null guards where needed
4. Enable `noUncheckedIndexedAccess`
5. Add explicit return types to all exported functions
6. Remove remaining `// @ts-ignore` comments

---

## Effort Summary

| Phase | Files (src) | Files (test) | Effort |
|-------|-------------|-------------|--------|
| 0 — Infrastructure | 0 | 0 | 1–2 days |
| 1 — Type Foundation | 3–5 | 0 | 1–2 days |
| 2 — Core | 8 | ~12 | 3–5 days |
| 3 — Mappers/Utils | 5 | ~4 | 1–2 days |
| 4 — MBNA Integration | 12 | ~8 | 2–3 days |
| 5 — API | 9 | ~10 | 3–5 days |
| 6 — Common Services | 12 | ~10 | 2–3 days |
| 7 — CanadaLife Services | 3 | ~3 | 1–2 days |
| 8 — Rogers Bank Services | 2 | ~4 | 1 day |
| 9 — Questrade Services | 8 | ~5 | 2–3 days |
| 10 — WS Transaction Rules | 3 | ~6 | 1–2 days |
| 11 — WS Core Services | 5 | ~6 | 2–3 days |
| 12 — WS Top-Level Services | 3 | ~3 | 1–2 days |
| 13 — UI | 32 | ~18 | 5–8 days |
| 14 — Strictness | all | all | 2–3 days |
| **Total** | **~106** | **~92** | **28–45 days** |

**Realistic calendar estimate:** 6–10 weeks for a single developer.

---

## Risks & Mitigations

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **GM_* / Tampermonkey globals** | TS may not recognize GM_ functions | Use `@types/tampermonkey` + custom `.d.ts` for missing functions (GM_addElement) |
| **Webpack externals for GM_*** | TS tries to resolve imports that are actually runtime globals | Keep externals config; declare globals in `.d.ts` |
| **DOM-heavy UI code** | Typing `createElement` chains is tedious, low ROI | Use `HTMLElement` generics; accept `as HTMLInputElement` casts in UI layer |
| **Test file volume** | 61,600 lines of tests — converting is high effort, low type-safety value | Convert test files last; keep `.js` tests importing `.ts` sources via `allowJs` |

### Medium Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **JS↔TS coexistence during migration** | Type information lost at `.js` → `.ts` import boundaries | Write thin `.d.ts` stubs for unconverted modules; prioritize conversion order by dependency chain |
| **Jest + TS interaction** | Mock typing, `jest.fn()` generics, dynamic imports | Use `ts-jest` with `isolatedModules: true` for speed; add `jest.Mock<>` types incrementally |
| **ESLint rule migration** | ~80 style rules, many redundant with TS | Audit rules; drop formatting rules in favor of Prettier or TS-handled rules |

### Low Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing JSDoc types | Nearly mechanical to convert | — |
| Module structure | Clean ES module imports, no CommonJS in src | — |
| Bundle size | TS types erased at build time | No impact |

---

## Alternative Considered: JSDoc + `checkJs`

Before committing to full migration, an intermediate step is possible:

1. Add `tsconfig.json` with `{ "allowJs": true, "checkJs": true, "noEmit": true }`
2. Keep all files as `.js`
3. TypeScript type-checks existing JSDoc annotations
4. **Effort: 3–5 days** to fix surfaced type errors

This provides ~70% of TypeScript's value with ~10% of the effort and serves as a natural stepping stone. However, the full migration is preferred for:
- Native interface/type syntax (cleaner than JSDoc `@typedef`)
- Better IDE support (autocomplete, refactoring)
- Enforced type contracts at import boundaries
- Community convention for projects of this size

---

## Conventions for Converted Files

### File Naming
- Source: `*.js` → `*.ts` (same name, different extension)
- Tests: `*.test.js` → `*.test.ts`
- Type-only files: `*.ts` in `src/types/` or co-located `*.types.ts`

### Import Style
- Use explicit `.js` extension in imports (for ESM compatibility) or configure `moduleResolution: "bundler"` in tsconfig
- Prefer named exports; use `export type` for type-only exports

### Type Annotations
- All exported functions must have explicit parameter and return types
- Internal functions may use type inference where unambiguous
- Prefer `interface` over `type` for object shapes (extendability)
- Use `unknown` instead of `any` wherever possible

### Migration Commit Pattern
- One commit per file or small group of related files
- Commit message: `refactor: convert {filename} to TypeScript`
- Each commit must pass `npm run lint && npm test && npm run build`