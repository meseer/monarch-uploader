# TypeScript Migration Plan

> **Status:** Active  
> **Updated:** 2026-03-11 (All source files converted — 105/105)  
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
| 11 | WS Core Services | ✅ Complete | 5/5 src / 0 test |
| 12 | WS Top-Level Services | ✅ Complete | 3/3 src / 0 test |
| 13a | UI Primitives | ✅ Complete | 6/6 src / 0 test |
| 13b | Category Selector Cluster | ✅ Complete | 3/3 src / 0 test |
| 13c | Dialog & Picker Components | ✅ Complete | 4/4 src / 0 test |
| 13d | Settings Modal Cluster | ✅ Complete | 4/4 src / 0 test |
| 13e | Generic Base UI | ✅ Complete | 3/3 src / 0 test |
| 13f | Questrade UI | ✅ Complete | 2/2 src / 0 test |
| 13g | Wealthsimple UI | ✅ Complete | 3/3 src / 0 test |
| 13h | Rogers Bank UI | ✅ Complete | 3/3 src / 0 test |
| 13i | CanadaLife UI | ✅ Complete | 3/3 src / 0 test |
| 13j | Entry Points | ✅ Complete | 2/2 src / 0 test |
| 15 | Shared Type System | 🔄 In Progress | — |
| 14 | Strictness Ramp-up | ⏸️ Deferred | — |

**Overall:** 105/105 source files converted (100%) 🎉

> **Note:** `categorySelector.example.js` was deleted (dead code — development demo with no production imports or tests). Total file count is 105 not 106.

## Overview

Migrate the monarch-uploader codebase from JavaScript (with JSDoc type annotations) to TypeScript. The project currently has **105 source files (~52,100 lines)** and **92 test files (~61,600 lines)** across a well-structured layered architecture.

## Current State

### Codebase Inventory

| Layer | Files | Lines | Largest File |
|-------|-------|-------|-------------|
| UI (`src/ui/`) | 31 | ~11,800 | accountSelectorWithCreate.js (1,372) |
| Services (`src/services/`) | 36 | ~18,000 | canadalife-upload.ts (1,359) |
| Integrations (`src/integrations/`) | 14 | ~3,500 | Newest modular architecture |
| API (`src/api/`) | 9 | ~7,500 | wealthsimpleQueries.ts (1,676) |
| Core (`src/core/`) | 8 | ~5,000 | utils.ts (914) |
| Mappers (`src/mappers/`) | 3 | ~1,500 | Category/merchant mapping |
| Utils (`src/utils/`) | 2 | ~800 | CSV, transaction storage |
| Other (index, metadata, scriptInfo) | 2 | ~200 | Entry point, build metadata |
| **Tests** | **92** | **~61,600** | Mirror of source structure |

### Existing Type System

The project already has a significant JSDoc type system:

- `src/integrations/types.ts` — ~310 lines of interface definitions (IntegrationManifest, IntegrationApi, SyncHooks, all callback types)
- `src/sinks/types.ts` — ~130 lines of interface definitions (DataSink, SinkAccount, SinkHolding, etc.)
- `src/core/httpClient.ts` — interfaces for HttpClient, HttpRequestOptions, HttpResponse
- `src/core/storageAdapter.ts` — interfaces for StorageAdapter

### Build Toolchain

| Tool | Current | Purpose |
|------|---------|---------|
| Webpack 5 | `webpack.config.cjs` | Bundle to single `.user.js` file |
| Babel | `.babelrc` with `@babel/preset-env` + `@babel/preset-typescript` | ES6+ transpilation, browser targeting, TS stripping |
| ESLint 10 | `eslint.config.mjs` with ~80 rules + typescript-eslint | Code quality |
| Jest 30 | `jest.config.cjs` with jsdom | Testing |
| c8 | Via `test:coverage` script | Code coverage |
| TypeScript | `tsconfig.json` with `noEmit: true` | Type checking only |

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

### Phase 0: Infrastructure Setup ✅ Complete

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

### Phase 1: Type Foundation ✅ Complete

Convert type-only files from JSDoc `@typedef` to native TypeScript interfaces.

**Files converted:**
- `src/integrations/types.js` → `src/integrations/types.ts`
- `src/sinks/types.js` → `src/sinks/types.ts`

### Phase 2: Core Layer ✅ Complete

Convert the foundation that everything else imports from.

**Files (8):** config, state, utils, httpClient, storageAdapter, integrationCapabilities, integrationRegistry, navigation

### Phase 3: Mappers & Utils ✅ Complete

Small, pure-function files with high type-safety value.

**Files (5):** category, merchant, wealthsimple-account-types, csv, transactionStorage

### Phase 4: MBNA Integration ✅ Complete

Converted the reference integration to establish TypeScript patterns for all future integrations.

**Files (12):** manifest, index, source/api, source/auth, source/injectionPoint, source/balanceReconstruction, sinks/monarch/index, sinks/monarch/csvFormatter, sinks/monarch/balanceFormatter, sinks/monarch/transactions, sinks/monarch/pendingTransactions, sinks/monarch/syncHooks

### Phase 5: API Layer ✅ Complete

Highest-value phase — API response shapes are where most runtime bugs originate.

**Files (9):** canadalife, monarch, monarchAccounts, monarchTransactions, questrade, rogersbank, wealthsimple, wealthsimplePositions, wealthsimpleQueries

### Phase 6: Common Services Foundation ✅ Complete

**Files (12):** auth, configStore, legacyMigration, pendingReconciliation, csvFormatter, accountService, deduplication, balanceUpload, creditLimitSync, transactionUpload, accountMappingResolver, syncOrchestrator

### Phase 7: CanadaLife Services ✅ Complete

**Files (3):** transactions, pendingReconciliation, canadalife-upload

### Phase 8: Rogers Bank Services ✅ Complete

**Files (2):** pendingTransactions, rogersbank-upload

### Phase 9: Questrade Services ✅ Complete

**Batch A (4 files):** auth, transactionRules, accountMapping, account  
**Batch B (4 files):** transactions, balance, positions, sync

### Phase 10: WS Transaction Rules ✅ Complete

**Files (3):** transactionRulesHelpers, transactionRulesInvestment, transactionRules  
Added full `WealthsimpleTransaction` interface, `ExtendedOrder`, `SpendDetails`, and other shared types to `transactionRulesHelpers.ts`.

### Phase 11: WS Core Services ✅ Complete

**Batch A (3 files):** transactionsReconciliation, transactionsHelpers, balance  
**Batch B (2 files):** transactionsInvestment, transactions

### Phase 12: WS Top-Level Services ✅ Complete

**Files (3):** positions, account, wealthsimple-upload

### Phase 13a: UI Primitives ✅ Complete

Zero or minimal inter-UI-file dependencies — converted first to unblock everything else.

| File | Lines |
|------|-------|
| `src/ui/toast.ts` | 151 |
| `src/ui/theme.ts` | 290 |
| `src/ui/keyboardNavigation.ts` | 225 |
| `src/ui/components/formValidation.ts` | 286 |
| `src/ui/components/confirmationDialog.ts` | 151 |
| `src/ui/components/monarchLoginLink.ts` | 251 |

---

### Phase 13b: Category Selector Cluster ✅ Complete

Self-contained subsystem with internal dependency chain. Converted in order: utils → manual → main.

| File | Lines |
|------|-------|
| `src/ui/components/categorySelectorUtils.ts` | 279 |
| `src/ui/components/categorySelectorManual.ts` | 378 |
| `src/ui/components/categorySelector.ts` | 1,020 |

> **Note:** `categorySelector.example.js` (233 lines) was deleted — it was a development demo file with no production imports or test coverage.

---

### Phase 13c: Dialog & Picker Components ✅ Complete

Interactive components consumed by services and the settings modal.

| File | Lines |
|------|-------|
| `src/ui/components/datePicker.ts` | 480 |
| `src/ui/components/securitySelector.ts` | 484 |
| `src/ui/components/accountCreationDialog.ts` | 620 |
| `src/ui/components/accountSelectorWithCreate.ts` | 1,372 |

---

### Phase 13d: Settings Modal Cluster ✅ Complete

The most complex sub-system. Converted in order: helpers → accountCards → settingsModal → progressDialog.

| File | Lines |
|------|-------|
| `src/ui/components/settingsModalHelpers.ts` | 1,280 |
| `src/ui/components/settingsModalAccountCards.ts` | 1,278 |
| `src/ui/components/settingsModal.ts` | 807 |
| `src/ui/components/progressDialog.ts` | 1,248 |

---

### Phase 13e: Generic Base UI ✅ Complete

Converted the generic/base UI components that institution-specific managers extend or mirror.

| File | Lines |
|------|-------|
| `src/ui/generic/uiManager.ts` | ~350 |
| `src/ui/generic/components/uploadButton.ts` | ~350 |
| `src/ui/generic/components/connectionStatus.ts` | ~275 |

---

### Phase 13f: Questrade UI ✅ Complete

| File | Lines |
|------|-------|
| `src/ui/questrade/uiManager.ts` | ~700 |
| `src/ui/questrade/components/uploadButton.ts` | ~466 |

---

### Phase 13g: Wealthsimple UI ✅ Complete

| File | Lines |
|------|-------|
| `src/ui/wealthsimple/uiManager.ts` | ~400 |
| `src/ui/wealthsimple/components/uploadButton.ts` | ~400 |
| `src/ui/wealthsimple/components/connectionStatus.ts` | ~285 |

---

### Phase 13h: Rogers Bank UI ✅ Complete

| File | Lines |
|------|-------|
| `src/ui/rogersbank/uiManager.ts` | ~350 |
| `src/ui/rogersbank/components/uploadButton.ts` | ~300 |
| `src/ui/rogersbank/components/connectionStatus.ts` | ~247 |

---

### Phase 13i: CanadaLife UI ✅ Complete

| File | Lines |
|------|-------|
| `src/ui/canadalife/uiManager.ts` | ~600 |
| `src/ui/canadalife/components/uploadButton.ts` | ~500 |
| `src/ui/canadalife/components/connectionStatus.ts` | ~392 |

---

### Phase 13j: Entry Points ✅ Complete

Converted the application entry point and integration barrel export. Updated webpack entry from `./src/index.js` to `./src/index.ts`.

| File | Lines |
|------|-------|
| `src/index.ts` | ~150 |
| `src/integrations/index.ts` | ~100 |

---

### Phase 15: Shared Type System — 🔄 In Progress

> **Status:** In progress  
> **ADR:** [ADR-006](../decisions/006-shared-type-system.md)

**Problem:** During the TS migration, three layers of independent type definitions emerged for Monarch domain concepts (accounts, categories, balances). This caused 11+ `as unknown as X` double casts and 1 `Promise<any>` workaround when data crossed layer boundaries.

**Solution:** Create `src/types/monarch.ts` — a single canonical module for cross-boundary Monarch domain types.

#### Sub-task 1: Category pipeline types
- Create `src/types/monarch.ts` with `MonarchCategory`, `CategoryGroup`, `SimilarityInfo`, `CategoryCallbackResult`
- Update `src/mappers/category.ts` to return `SimilarityInfo`-compatible data
- Update `src/ui/components/categorySelector.ts` to import shared types
- **Eliminates:** 4× `as unknown as SimilarityInfo` in service files

#### Sub-task 2: Account pipeline types
- Add `AccountDetails`, `BalanceInfo` to shared types
- Update `src/ui/components/accountSelectorWithCreate.ts` to use shared types
- Unify `BalanceInfo` in `src/core/utils.ts` with shared definition
- Unify `CurrentBalance` in `src/services/wealthsimple/account.ts`
- **Eliminates:** `Promise<any>` in accountMapping, `as unknown as Parameters<...>` casts

#### Sub-task 3: Remaining cleanup
- Clean up remaining `as unknown as` casts that were workarounds
- Audit for any remaining `any` types introduced during migration

| Metric | Count |
|--------|-------|
| Double casts eliminated | 11+ |
| `Promise<any>` eliminated | 1 |
| Files modified | ~18 |

---

### Phase 14: Strictness Ramp-up — ⏸️ Deferred

> **Status:** Deferred indefinitely. To be reconsidered when a specific pain point arises (e.g., a null-dereference bug that strict mode would have caught).

**Rationale for deferral:**
1. `noUncheckedIndexedAccess` adds `| undefined` to every array/object access, generating hundreds of fixes across 105 files — very high effort for very low bug-prevention value in a userscript context.
2. The DOM-heavy UI layer means `document.getElementById()` returns `HTMLElement | null` everywhere — strict null checking adds defensive code the runtime doesn't need (elements always exist because we create them).
3. The codebase already has good type annotations, meaning the actual "implicit any" surface is small.
4. This is a single-developer userscript with good test coverage. The ROI on strict mode doesn't justify the effort.

**If activated later, steps would be:**
1. Enable `strict: true` in `tsconfig.json`
2. Fix all `any` types and implicit anys
3. Enable `strictNullChecks` — add null guards where needed
4. Enable `noUncheckedIndexedAccess`
5. Add explicit return types to all exported functions
6. Remove remaining `// @ts-ignore` comments

---

## Effort Summary

| Phase | Files (src) | Effort |
|-------|-------------|--------|
| 0 — Infrastructure | 0 | ✅ Done |
| 1 — Type Foundation | 2 | ✅ Done |
| 2 — Core | 8 | ✅ Done |
| 3 — Mappers/Utils | 5 | ✅ Done |
| 4 — MBNA Integration | 12 | ✅ Done |
| 5 — API | 9 | ✅ Done |
| 6 — Common Services | 12 | ✅ Done |
| 7 — CanadaLife Services | 3 | ✅ Done |
| 8 — Rogers Bank Services | 2 | ✅ Done |
| 9 — Questrade Services | 8 | ✅ Done |
| 10 — WS Transaction Rules | 3 | ✅ Done |
| 11 — WS Core Services | 5 | ✅ Done |
| 12 — WS Top-Level Services | 3 | ✅ Done |
| 13a — UI Primitives | 6 | ✅ Done |
| 13b — Category Selector Cluster | 3 | ✅ Done |
| 13c — Dialog & Picker Components | 4 | ✅ Done |
| 13d — Settings Modal Cluster | 4 | ✅ Done |
| 13e — Generic Base UI | 3 | ✅ Done |
| 13f — Questrade UI | 2 | ✅ Done |
| 13g — Wealthsimple UI | 3 | ✅ Done |
| 13h — Rogers Bank UI | 3 | ✅ Done |
| 13i — CanadaLife UI | 3 | ✅ Done |
| 13j — Entry Points | 2 | ✅ Done |
| 14 — Strictness | all | ⏸️ Deferred |
| **Total remaining** | **0** | **✅ All source files converted** |

---

## Risks & Mitigations

### High Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| **GM_* / Tampermonkey globals** | TS may not recognize GM_ functions | Use `@types/tampermonkey` + custom `.d.ts` for missing functions (GM_addElement) |
| **Webpack externals for GM_*** | TS tries to resolve imports that are actually runtime globals | Keep externals config; declare globals in `.d.ts` |
| **DOM-heavy UI code** | Typing `createElement` chains is tedious, low ROI | Use TypeScript's built-in `lib.dom.d.ts` types; accept `as HTMLInputElement` casts in UI layer |
| **Test file volume** | 61,600 lines of tests — converting is high effort, low type-safety value | Keep `.js` tests importing `.ts` sources via `allowJs` — tests do not need type checking |

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
- Tests: remain as `*.test.js` (no conversion planned — tests import TS sources transparently)
- Type-only files: `*.ts` in `src/types/` or co-located `*.types.ts`

### Import Style
- Use explicit `.js` extension in imports (for ESM compatibility) or configure `moduleResolution: "bundler"` in tsconfig
- Prefer named exports; use `export type` for type-only exports

### Type Annotations
- All exported functions must have explicit parameter and return types
- Internal functions may use type inference where unambiguous
- Prefer `interface` over `type` for object shapes (extendability)
- Use `unknown` instead of `any` wherever possible

### DOM Typing Approach
- Use TypeScript's built-in `lib.dom.d.ts` types — no external DOM typing libraries needed
- Use `as HTMLInputElement`, `as HTMLSelectElement` etc. for narrowing `event.target` and `querySelector` results
- Define interfaces for component option objects (e.g., `CreateCategorySelectorOptions`)
- Accept that UI layer will have more `as` casts than other layers — this is expected and acceptable

### Migration Commit Pattern
- One commit per file or small group of related files
- Commit message: `refactor: convert {filename} to TypeScript`
- Each commit must pass `npm run lint && npm test && npm run build`