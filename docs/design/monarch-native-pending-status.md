# Monarch-Native Pending Status

> **Status:** Draft  
> **Updated:** 2026-09-07  
> **Author:** @meseer  
> **Note:** Rogers Bank only in this iteration. Monarch's `pending` mutation field is undocumented, so this is deliberately written to be harmless if the field does not work. Promote to **Active** and extend to MBNA/Wealthsimple once verified against the live API.

## Problem

Pending transactions have always been tracked with a **`Pending` tag**. Monarch's CSV
importer accepts a `Tags` column but has no column for the platform's own
`pending` field, so a tag was the only thing an import could set.

The tag works, but it is our convention, not Monarch's. Monarch's UI, filters,
reports and mobile app all understand `pending`; none of them understand a tag
called `Pending`. A transaction that is pending in reality looks settled to every
part of the product the user actually interacts with.

Monarch's GraphQL API *does* expose `pending` — it is returned by
`getTransactionsList` and by the `updateTransaction` mutation's response
fragment. Whether it is **writable** is unknown: it is not part of any documented
contract, and Monarch may reject it, ignore it, or accept it.

## Approach: layer the native flag on top of the tag

The native flag is added as an **additional** signal. Nothing about the existing
tag machinery changes:

| Concern | Before | After this change |
|---------|--------|-------------------|
| Writing the `Pending` tag on import | CSV `Tags` column | **unchanged** |
| Finding pending transactions | query by `Pending` tag | **unchanged** |
| Reconciling settled/cancelled | `Pending` tag + notes hash | **unchanged** |
| Removing the tag on settle | `setTransactionTags` | **unchanged** |
| Monarch-native `pending` | never set | set post-upload, cleared on settle |

If the field turns out to be unwritable, every one of those rows still behaves
exactly as it does today. That is the whole point of the design.

## The `Pending` tag is the work queue

The tag is not merely a label to be replaced — it is reused as the **queue** that
drives the new pass, exactly as `pendingOwnerUpdate` drives owner sync.

This falls out of a property the tag already has: it is written by the import and
removed by reconciliation, so at any moment the set of `Pending`-tagged rows *is*
the set of transactions that should be natively pending. Nothing extra needs to be
recorded or remembered.

Three consequences, all of which we want:

- **Robust.** The queue is self-maintaining and always accurate, because it is
  maintained by machinery that already had to be correct.
- **Crash-safe.** A row missed for any reason — batch cap, transient failure, an
  interrupted sync — still carries its tag and is picked up next sync. No state.
- **Clean migration.** There is no cut-over. The tag keeps being the source of
  truth; the native flag is derived from it. Even long-term there is no need to
  remove the tag *write* path.

## Components

```
                 ┌─────────────────────────────┐
                 │ api/monarchTransactions     │  updateTransactionWithPending()
                 │  • probes `pending`         │  + session support latch
                 │  • latches unsupported      │
                 └──────────────┬──────────────┘
                                │
        ┌───────────────────────┴────────────────────────┐
        │                                                │
┌───────┴──────────────┐                    ┌────────────┴─────────────┐
│ services/common/     │                    │ services/rogersbank/     │
│ pendingStatusSync    │  pending: true     │ pendingTransactions      │  pending: false
│ (Pending tag = queue)│                    │ (settle path)            │
└───────┬──────────────┘                    └──────────────────────────┘
        │
┌───────┴──────────────┐        ┌──────────────────────────┐
│ services/common/     │ reads  │ services/common/         │
│ postSyncUpdates      ├───────►│ markerTagQueue           │
│ (pass registry)      │        │ (shared queue mechanics) │
└──────────────────────┘        └──────────────────────────┘
```

### `api/monarchTransactions` — where the uncertainty is contained

`updateTransactionWithPending(id, updates, pending)` owns every bit of knowledge
about whether the field works. Whether a Monarch field is writable is an
API-level fact, so it belongs in the API client, not in a service.

Three outcomes are handled:

1. **Accepted** → one mutation, `pendingApplied: true`.
2. **Rejected** (mutation throws) → trip the latch, **retry once without the
   field** so the caller's real work (notes, owner, amount) still lands.
3. **Silently ignored** (mutation succeeds but the returned `pending` differs from
   what was requested) → trip the latch, `pendingApplied: false`. No retry needed;
   the rest of the update already applied.

Case 3 is only detectable because the mutation's response fragment selects
`pending`. Without that check, an ignored field would be indistinguishable from
success.

The latch (`isPendingFieldSupported()`) is **session-scoped**, not persisted: a
page reload is a free, self-healing re-probe if Monarch adds support later.

**Cost of an unsupported field: exactly one wasted mutation per session.**

### `services/common/markerTagQueue` — shared queue mechanics

Extracted (behaviour-preserving) from `ownerSync`, which had it privately. Two
behaviours every marker-driven pass needs:

- **Tag propagation tolerance.** The first pass after an import runs seconds after
  the tag was created and Monarch's tag list may not show it yet, so the lookup
  retries 3× with a 1s delay. Failing is safe — the rows keep their tag.
- **A year-ahead window.** Users can edit dates; without looking forward, a
  future-dated row would keep its marker forever and never be processed.

### `services/common/pendingStatusSync` — the new pass

Reads the `Pending` tag queue and flags rows that are not yet natively pending.

- Rows already `pending === true` are **skipped** — the steady state, so in normal
  operation this pass issues **zero mutations** and costs one list query.
- Stops the moment the API latch trips, so an unsupported field cannot cost more
  than that one mutation.
- Capped per sync, wrapped, **never throws**. Touches neither tags nor notes.
- Reported as **`skipped` / "Not supported"**, never `error` — a missing platform
  feature must not make a healthy sync look broken.

### `services/common/postSyncUpdates` — capability-driven pass registry

Monarch's importer cannot express everything a transaction needs, so post-upload
passes are a recurring pattern (owner today, pending status now, more later).
Previously each was wired by hand per integration, with its step declared in one
place and executed in another — two edits per pass per integration, and an easy
way to drift.

The passes are now **data**:

```ts
POST_SYNC_PASSES = [
  { key: 'ownerSync',     isEnabled, run, format },
  { key: 'pendingStatus', isEnabled, run, format },
]
```

`buildPostSyncSteps()` and `runPostSyncUpdates()` walk the same array, so a
declared step is always executed and vice versa. Adding a pass is one entry.

Design choices:

- **Per-pass steps kept**, not collapsed into one opaque "post-sync" row: specific
  messages ("3 owners set" vs "12 already pending") are more useful, and the
  existing `ownerSync` step key stays stable.
- **Passes are isolated.** One failing pass never blocks another, and none can
  abort a sync.
- **Ordering matters.** Owner sync runs first so its mutation can carry the
  pending flag (`flagPending`), leaving the pending pass nothing to do for those
  rows — saving a second mutation each.

### The piggyback

When a row needs *both* an owner and the pending flag, `ownerSync` bundles them
into the **same** mutation. Free, because the mutation was happening anyway; and
safe, because the write is defensive — if the field is rejected, the retry still
applies the owner.

`flagPending` is **opt-in per caller**, not automatic. A transaction must only be
flagged natively pending by an integration whose settle path also *clears* the
flag; otherwise it would stay pending in Monarch forever. Callers that do not pass
it are byte-identical to pre-feature behaviour.

## Symmetry: set and clear

Every place that sets `pending: true` must have a counterpart that clears it:

| Set | Cleared |
|-----|---------|
| `pendingStatusSync` (post-upload) | Rogers settle path in `pendingReconciliation` |
| `ownerSync` piggyback (post-upload) | same |

The clear rides along with the notes update that the settle path already issues —
same call, same defensive fallback.

This symmetry is exactly why the rollout is staged per integration rather than
enabled globally.

## Rollout status

| Integration | Flags pending | Clears on settle | Notes |
|-------------|:-------------:|:----------------:|-------|
| Rogers Bank | ✅ | ✅ | First integration; `pendingStatusEnabled: true` |
| MBNA | ❌ | ❌ | Next — goes via `syncOrchestrator` |
| Wealthsimple | ❌ | ❌ | Has its own step machinery |
| Canada Life | ❌ | ❌ | |

### Extending to another integration

1. Clear the flag in that integration's settle path — swap its
   `updateTransaction(id, { notes, … })` for
   `updateTransactionWithPending(id, { notes, … }, false)`.
2. Set `pendingStatusEnabled: true` in its `PostSyncContext`.
3. Ensure the integration builds its steps via `buildPostSyncSteps()` and runs
   `runPostSyncUpdates()` after upload **and** after reconciliation.
4. Add tests mirroring `pendingTransactions.test.js` → *native pending status*.

Do **not** do step 2 without step 1.

## What to verify in local testing

1. A newly-uploaded pending transaction shows as pending in Monarch's UI, not just
   tagged.
2. On settle, the native pending state clears **and** the `Pending` tag is removed.
3. If the field is unsupported: the "Pending status" step reads **"Not supported"**,
   the sync otherwise completes normally, and only one wasted mutation appears in
   the debug log.
4. Owner sync still applies owners correctly on a Rogers account with owner mapping
   on (the piggyback must not regress it).
5. A second sync with no new data reports "N already pending" and issues no
   mutations.

## Open question

Whether Monarch's `updateTransaction` accepts `pending` at all. Everything above
is structured so that the answer determines only how much benefit is gained —
never whether the sync works.