# ADR-004: Reorganize Documentation into docs/

> **Status:** Accepted  
> **Date:** 2026-02-20  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

The project had a flat `design/` directory containing all documentation:

```
design/
├── cloud-sync.md
├── eliminate-upload-services-plan.md
├── metrics-and-instrumentation.md
├── modular-integration-architecture.md
├── settings-unification-plan.md
├── skip-categorization-plan.md
└── integration/
    ├── mbna-integration-plan.md
    └── adding-a-new-integration.md   ← runbook mixed with design docs
```

Two problems:

1. **Mixed document types:** Architecture reference docs ("why things are designed this way") and operational runbooks ("how to do a specific task") were in the same folder. They have different audiences, different lifespans, and different update cadences.

2. **No standard root:** The dominant OSS convention (Kubernetes, React, TypeScript, VS Code, Homebrew) and documentation tooling (GitHub Pages, Docusaurus, MkDocs, VitePress) use `docs/` as the documentation root. Using `design/` diverged from this convention without a specific reason.

Additionally, design docs had no status metadata, making it unclear which were current, implemented, draft, or abandoned.

## Decision

Reorganize documentation into a standard `docs/` root subdivided by type:

```
docs/
├── README.md                    ← Documentation index
├── design/                      ← Architecture decisions, RFCs, design docs
│   ├── modular-integration-architecture.md
│   ├── cloud-sync.md
│   ├── metrics-and-instrumentation.md
│   ├── eliminate-upload-services-plan.md
│   ├── settings-unification-plan.md
│   ├── skip-categorization-plan.md
│   └── integration/
│       └── mbna-integration-plan.md
├── runbooks/                    ← Operational SOPs, step-by-step how-to guides
│   └── adding-a-new-integration.md
└── decisions/                   ← Architecture Decision Records (ADRs)
    ├── README.md
    ├── 000-template.md
    ├── 001-modular-integration-architecture.md
    ├── 002-mbna-as-reference-implementation.md
    ├── 003-manifest-as-source-of-truth.md
    └── 004-docs-folder-reorganization.md   ← this document
```

Each document gets a front-matter status block:

```markdown
> **Status:** Active | Draft | Implemented | Superseded | Deprecated  
> **Updated:** YYYY-MM-DD  
> **Author:** @handle  
> **Note:** optional context  
```

The old `design/` directory is **removed** after the migration; git history preserves the full change record.

## Consequences

### Positive
- Single, predictable location for all project documentation
- Clear separation of concerns: architecture docs vs. operational runbooks vs. decision records
- Status blocks make it immediately clear which docs are current vs. stale
- ADRs provide a durable record of *why* architectural decisions were made, not just what was decided
- Aligns with OSS conventions and documentation tooling defaults

### Negative / Trade-offs
- Any existing bookmarks or links to `design/` files are broken (mitigated by git history)
- Team members need to update any personal notes pointing to old paths

### Neutral
- The old `design/` directory is deleted; the new `docs/` directory is the canonical location going forward
- Future design docs go in `docs/design/`; future how-to guides go in `docs/runbooks/`; future architectural decisions go in `docs/decisions/`

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Keep `design/` with a `runbooks/` subdirectory | Doesn't align with OSS conventions; `design/` as root is non-standard |
| Use `docs/` flat (no subdirectories) | Doesn't separate doc types; becomes cluttered as the project grows |
| Keep `design/` as-is | Mixed doc types, no status metadata, non-standard root |