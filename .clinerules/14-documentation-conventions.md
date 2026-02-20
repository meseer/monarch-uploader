# Documentation Conventions

## Structure

All documentation lives under `docs/`:
- `docs/design/` — architecture reference docs (explain *why*)
- `docs/runbooks/` — step-by-step operational guides (explain *how*)
- `docs/decisions/` — Architecture Decision Records (ADRs)
- `docs/README.md` — documentation index (update when adding files)

## Every Document Must Have a Front-Matter Block

Insert after the H1 heading:

```markdown
> **Status:** Active  
> **Updated:** YYYY-MM-DD  
> **Author:** @handle  
> **Note:** optional context (omit if not needed)  
```

## Status Values

| Status | When to use |
|--------|-------------|
| `Active` | Current, authoritative, reflects the codebase |
| `Draft` | Proposed but not implemented |
| `Implemented` | Completed — kept for history, do not edit |
| `Superseded` | Replaced by a newer doc — add `**Superseded by:** [link]` |
| `Deprecated` | No longer applicable |

## Rules

- **Living docs** (`Active`): edit in place, update `Updated` date.
- **Historical docs** (`Implemented`, `Superseded`): do not edit; create a new doc and cross-link.
- **ADRs** (`docs/decisions/`): immutable once `Accepted`. Write a new ADR that supersedes; never edit the old one. Use `docs/decisions/000-template.md`.
- Update `docs/README.md` index table whenever a doc is added or its status changes.
- ADR numbering is sequential (`NNN-kebab-title.md`).