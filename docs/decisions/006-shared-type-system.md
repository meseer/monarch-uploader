# ADR-006: Introduce Shared Monarch Domain Type System

> **Status:** Accepted  
> **Date:** 2026-03-11  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

After completing the TypeScript migration (ADR-005), 105 source files were converted from JavaScript to TypeScript. During the final phase of fixing `tsc --noEmit` errors to reach zero type errors, pragmatic workarounds were applied:

- **11 `as unknown as X` double casts** across service files — required because data flows from API layer (returning `Record<string, unknown>`) through services to UI components that define their own incompatible interfaces.
- **1 `Promise<any>`** in `accountMapping.ts` — callback type incompatibility between `AccountDetails` (defined locally in `accountSelectorWithCreate.ts`) and the `Record<string, unknown>` type expected by the callback.
- **Type duplication** — the same domain concept (e.g., a Monarch account, a category, a balance) was independently defined in 2–3 different layers with slightly different shapes.

Three layers of independent type definitions had emerged during conversion:

1. **API layer** (`src/api/monarch.ts`, `monarchAccounts.ts`) — functions return typed interfaces (`MonarchAccount`, `MonarchCategory`, etc.) but callers often receive them as `Record<string, unknown>` due to the generic `callMonarchGraphQL` return type.
2. **UI layer** (`src/ui/components/categorySelector.ts`, `accountSelectorWithCreate.ts`) — defines local interfaces (`MonarchCategory`, `SimilarityInfo`, `CategoryGroup`, `AccountDetails`) that are structurally similar but not identical to API types.
3. **Service layer** (`src/services/wealthsimple/account.ts`, `src/core/utils.ts`) — defines its own interfaces (`CurrentBalance`, `MonarchAccount`, `BalanceInfo`) that overlap with both API and UI definitions.

This duplication causes:
- Double casts when data crosses layer boundaries (e.g., `calculateAllCategorySimilarities()` returns `CategorySimilarityData` but callers need `SimilarityInfo` from the UI layer).
- Fragile code — changing a field in one layer's definition doesn't propagate to the others.
- Confusing DX — multiple `MonarchAccount` interfaces with different shapes.

## Decision

We will create a shared Monarch domain type module at `src/types/monarch.ts` that serves as the single canonical source for types that cross layer boundaries. All layers (API, services, UI) will import from this module instead of defining local interfaces.

Key principles:

1. **Only types that cross boundaries** go in the shared module. Layer-internal types (e.g., `SearchCategoryItem` used only within `categorySelector.ts`) remain local.
2. **`[key: string]: unknown` index signatures** are included on shared types that originate from API responses, allowing them to carry extra fields without breaking type compatibility.
3. **Existing well-scoped type modules are not merged** — `src/sinks/types.ts` (DataSink interface) and `src/integrations/types.ts` (IntegrationManifest) serve different architectural boundaries and remain separate.
4. **The `calculateAllCategorySimilarities` return type** is updated to use shared types, eliminating the most common source of double casts (4 call sites).
5. **`callMonarchGraphQL` remains `Promise<any>`** — typing every GraphQL response shape is a separate, larger effort. The shared types are applied at the boundary where API results are destructured.

## Consequences

### Positive
- Eliminates 11+ `as unknown as X` double casts and 1 `Promise<any>` workaround
- Single source of truth for cross-boundary types — field changes propagate automatically
- Clearer import paths — `import { SimilarityInfo } from '../../types/monarch'` instead of importing from a UI component
- Foundation for future strict mode adoption (fewer `any` and `unknown` casts to fix)

### Negative / Trade-offs
- New `src/types/` directory adds a layer of indirection for types
- Shared types must be kept in sync with actual API response shapes (no compile-time guarantee since GraphQL responses are untyped)
- Some types have `[key: string]: unknown` which is permissive — this is intentional to maintain backward compatibility but means TypeScript won't catch typos on extra properties

### Neutral
- No runtime behavior changes — types are erased at build time
- Bundle output is unchanged
- Test files are unaffected (they remain `.js` and don't type-check)

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| **Type every GraphQL response** | Very high effort — 15+ unique query shapes, each with nested fragments. Better addressed incrementally if/when `callMonarchGraphQL` is refactored to a typed wrapper. |
| **Use `src/sinks/types.ts` as the shared module** | SinkAccount/SinkCategory are abstract interfaces for the modular architecture. Monarch-specific types (with `__typename`, `group.id`, etc.) are a different concern and shouldn't pollute the sink abstraction. |
| **Keep types local, use declaration merging** | TypeScript declaration merging is fragile and confusing. A single canonical module is simpler and more maintainable. |
| **Do nothing (keep the double casts)** | The casts work but hide real type mismatches and make refactoring risky. The effort to fix is modest (~3 hours). |