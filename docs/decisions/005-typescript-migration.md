# ADR-005: Migrate Codebase to TypeScript

> **Status:** Accepted  
> **Date:** 2026-03-06  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

The monarch-uploader codebase has grown to ~52,300 lines of JavaScript across 106 source files with a layered architecture (API, services, core, UI, integrations). The project already maintains a significant JSDoc type system (~440 lines of `@typedef` definitions in `src/integrations/types.js` and `src/sinks/types.js`), indicating a need for type safety that JSDoc alone cannot fully enforce.

Key forces driving this decision:

- **Runtime type errors** — API response shapes, account data structures, and transaction objects pass through multiple layers without compile-time validation. Bugs surface at runtime rather than during development.
- **Refactoring risk** — Renaming fields, changing function signatures, or restructuring data flows requires manual grep-and-verify across 106 files. TypeScript's language server catches these at edit time.
- **New integration development** — The modular integration architecture (ADR-001) defines strict contracts (IntegrationManifest, SyncHooks, IntegrationApi). TypeScript enforces these contracts at compile time rather than relying on documentation.
- **JSDoc limitations** — Complex types (discriminated unions, mapped types, conditional types) are awkward or impossible in JSDoc. The existing `@typedef` annotations are already at the limit of what JSDoc can express cleanly.
- **Developer experience** — TypeScript provides superior autocomplete, inline documentation, and refactoring tools in VS Code, which is the project's IDE.

## Decision

We will incrementally migrate the entire codebase from JavaScript to TypeScript, following a bottom-up phase plan that converts files in dependency order: core → mappers/utils → MBNA integration (reference implementation) → API → services → UI.

Key decisions within the migration:

1. **Babel + `@babel/preset-typescript`** for compilation (not `ts-loader`), keeping the existing browser-targeting Babel pipeline intact.
2. **TypeScript for type-checking only** (`tsc --noEmit`), not for producing output.
3. **`allowJs: true`** during migration to permit `.js` and `.ts` files to coexist.
4. **MBNA converted early** (Phase 4, after core/mappers) to establish TypeScript patterns for the modular integration architecture before other integrations are converted.
5. **Strict mode deferred** to the final phase — start with `strict: false` and ramp up once all files are converted.

See [TypeScript Migration Plan](../design/typescript-migration-plan.md) for the full phase breakdown and effort estimates.

## Consequences

### Positive
- Compile-time type safety across all layers, especially API response shapes and cross-module contracts
- Integration contracts (IntegrationManifest, SyncHooks, DataSink) enforced by the compiler rather than documentation
- Superior IDE experience: autocomplete, go-to-definition, rename-symbol, inline type errors
- Safer refactoring — field renames and signature changes caught immediately
- Native interface/type syntax replaces verbose JSDoc `@typedef` blocks
- The MBNA reference implementation becomes a typed template for all future integrations

### Negative / Trade-offs
- **6–10 weeks of migration effort** for a single developer (~23–38 developer-days)
- During migration, `.js` ↔ `.ts` boundaries lose type information unless `.d.ts` stubs are maintained
- Test files (61,600 lines) add significant conversion volume with limited type-safety ROI
- Framework-less DOM manipulation in the UI layer (32 files) is tedious to type
- New dependency on TypeScript compiler and related tooling (`typescript`, `ts-jest`, `typescript-eslint`)
- Loss of `const enum` and namespace merging (Babel limitation) — acceptable since neither is needed

### Neutral
- Bundle output is unchanged — TypeScript types are erased at build time
- The `.user.js` output format and Tampermonkey compatibility are unaffected
- Build time may increase slightly due to type-checking step, mitigated by running `tsc --noEmit` as a separate script rather than in the webpack pipeline

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| **Stay with JavaScript + JSDoc** | JSDoc cannot express complex types (discriminated unions, generics with constraints); does not enforce types at import boundaries; IDE support inferior to native TS |
| **JSDoc + `checkJs` (intermediate step)** | Provides ~70% of TS value with ~10% effort, but leaves JSDoc syntax limitations in place. Considered as a stepping stone but not a final state — the full migration is preferred for long-term maintainability |
| **`ts-loader` only (drop Babel)** | Loses granular `@babel/preset-env` browser targeting; bigger single-step migration risk. Can re-evaluate post-migration |
| **Big-bang migration (convert all at once)** | Too risky for a 114K-line codebase; incremental approach allows continuous validation via `npm run build && npm test` at every step |