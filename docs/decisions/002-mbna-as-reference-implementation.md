# ADR-002: Use MBNA as the Reference Implementation

> **Status:** Accepted  
> **Date:** 2026-01-15  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

When introducing the modular integration architecture (see [ADR-001](001-modular-integration-architecture.md)), we needed to decide how to validate and document the architecture:

- **Design-only approach:** Write the architecture document and add integrations later. Risk: the design may be aspirational rather than proven; patterns may not work in practice.
- **Prototype approach:** Build a quick proof-of-concept with one integration to validate the design. Risk: prototype code gets scrapped; effort duplicated.
- **Full reference implementation:** Build the first real integration using the full architecture. This integration becomes both the validation of the architecture and the living example for future integrations.

MBNA was the next financial institution to support. It has a credit card account type, HttpOnly session cookies (no explicit login flow), transaction support, pending transactions, credit limit sync, and balance reconstruction — covering most capability types.

## Decision

We will implement **MBNA as a fully operational integration** under the modular architecture, and designate it the **reference implementation**. Specifically:

- All patterns documented in `docs/design/modular-integration-architecture.md` are derived from the MBNA implementation — not aspirational designs
- MBNA's code at `src/integrations/mbna/` is the canonical example for every file a new integration needs
- The runbook at `docs/runbooks/adding-a-new-integration.md` uses MBNA as its code examples throughout
- MBNA is deliberately kept absent from all legacy static maps (`config.js`, `INTEGRATION_CAPABILITIES`, `accountService.js`) to prove the manifest-driven approach works end-to-end

## Consequences

### Positive
- Architecture is proven, not aspirational — every pattern in the design doc has working code behind it
- New integration developers have a complete, working reference rather than abstract documentation
- Integration tests (`test/integrations/mbna/`) serve as acceptance tests for the architecture contracts
- Discovering any awkward patterns during MBNA implementation means they are fixed before they affect future integrations

### Negative / Trade-offs
- MBNA implementation effort was higher than a minimal prototype — complete SyncHooks, balance reconstruction, pending transaction reconciliation, and category mapping all implemented
- The reference implementation will drift from new best practices over time; it should be updated when patterns evolve

### Neutral
- Future integrations will deviate from MBNA where their capabilities differ (e.g., no credit limit, different auth approach); the runbook documents these decision points explicitly
- The architecture document explicitly warns: "All patterns documented here are derived from [MBNA's] implementation — not aspirational designs"

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Design-first, implement later | Leaves architecture unvalidated; patterns may not work in practice |
| Use Questrade as reference | Questrade is already implemented as legacy; migrating it would be scope-creep on the architecture work |
| Use a simplified "hello world" integration | A trivial integration wouldn't exercise all capability paths; wouldn't be useful as a template for real integrations |