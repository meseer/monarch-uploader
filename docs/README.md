# Monarch Uploader — Documentation

> **Status:** Active  
> **Updated:** 2026-02-20  
> **Author:** @meseer  

All project documentation lives here. See the [root README](../README.md) for project setup and installation.

---

## 📐 Design (`design/`)

Architecture reference documents. These explain *how* the system works and *why* it is designed that way.

| Document | Status | Description |
|----------|--------|-------------|
| [Modular Integration Architecture](design/modular-integration-architecture.md) | **Active** | Core architecture: manifest, registry, source/sink, SyncHooks, generic UI |
| [Cloud Sync Design](design/cloud-sync.md) | Draft | Cross-device settings sync via Firebase |
| [Metrics & Instrumentation](design/metrics-and-instrumentation.md) | Draft | Telemetry and usage analytics design |
| [Eliminate Upload Services Plan](design/eliminate-upload-services-plan.md) | Draft | Refactoring upload services into the modular architecture |
| [Settings UI Unification Plan](design/settings-unification-plan.md) | Implemented | Consolidated account storage design (now live) |
| [Skip Categorization Plan](design/skip-categorization-plan.md) | Draft | Per-account option to skip category mapping |
| [MBNA Integration Plan](design/integration/mbna-integration-plan.md) | Implemented | Planning document for the MBNA reference implementation |

---

## 📖 Runbooks (`runbooks/`)

Step-by-step operational guides. These explain *how to do specific tasks*.

| Document | Description |
|----------|-------------|
| [Adding a New Integration](runbooks/adding-a-new-integration.md) | Complete guide with incremental milestones from manifest stub to production-ready integration |

---

## 🏛️ Architecture Decision Records (`decisions/`)

Immutable records of significant architectural decisions and the reasoning behind them.

| # | Decision | Status | Date |
|---|----------|--------|------|
| [ADR-001](decisions/001-modular-integration-architecture.md) | Adopt Modular Integration Architecture | Accepted | 2026-01-10 |
| [ADR-002](decisions/002-mbna-as-reference-implementation.md) | Use MBNA as the Reference Implementation | Accepted | 2026-01-15 |
| [ADR-003](decisions/003-manifest-as-source-of-truth.md) | Integration Manifest as Single Source of Truth | Accepted | 2026-01-15 |
| [ADR-004](decisions/004-docs-folder-reorganization.md) | Reorganize Documentation into docs/ | Accepted | 2026-02-20 |

See [`decisions/README.md`](decisions/README.md) for ADR conventions and the template.

---

## Document Conventions

### Status Values

| Status | Meaning |
|--------|---------|
| **Active** | Current, authoritative, reflects the codebase |
| **Draft** | Proposed but not yet implemented |
| **Implemented** | Completed — kept for historical context |
| **Superseded** | Replaced by a newer document (see link) |
| **Deprecated** | No longer applicable |

### Updating Documents

- **Living docs** (`Active` status): Edit in place, update the `Updated` date in the front-matter.
- **Historical docs** (`Implemented`, `Superseded`): Do not edit; create a new document and link them together.
- **ADRs** (`decisions/`): Never edit once `Accepted`. Write a new ADR that supersedes the old one.