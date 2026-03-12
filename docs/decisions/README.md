# Architecture Decision Records

> **Status:** Active  
> **Updated:** 2026-02-20  
> **Author:** @meseer  

This directory contains Architecture Decision Records (ADRs) — short documents that capture significant architectural decisions made during development.

## What is an ADR?

An ADR records:
- **Context** — the situation that necessitated a decision
- **Decision** — what was decided
- **Consequences** — the resulting trade-offs and implications

ADRs are **immutable once accepted**. If a decision changes, a new ADR is written that supersedes the old one (which is then marked `Superseded`).

## Index

| # | Title | Status | Date |
|---|-------|--------|------|
| [001](001-modular-integration-architecture.md) | Adopt Modular Integration Architecture | Accepted | 2026-01-10 |
| [002](002-mbna-as-reference-implementation.md) | Use MBNA as the Reference Implementation | Accepted | 2026-01-15 |
| [003](003-manifest-as-source-of-truth.md) | Integration Manifest as Single Source of Truth | Accepted | 2026-01-15 |
| [004](004-docs-folder-reorganization.md) | Reorganize Documentation into docs/ | Accepted | 2026-02-20 |
| [005](005-typescript-migration.md) | Migrate Codebase to TypeScript | Accepted | 2026-03-06 |
| [006](006-shared-type-system.md) | Introduce Shared Monarch Domain Type System | Accepted | 2026-03-11 |

## Template

Use [000-template.md](000-template.md) as the starting point for new ADRs.

## Statuses

| Status | Meaning |
|--------|---------|
| **Draft** | Under discussion, not yet accepted |
| **Accepted** | Decision is in effect |
| **Superseded** | Replaced by a newer ADR (see link) |
| **Rejected** | Considered but not adopted |
| **Deprecated** | Was in effect but no longer applies |