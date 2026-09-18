# Monarch-Native Pending Status

> **Status:** Deprecated  
> **Updated:** 2026-09-18  
> **Author:** @meseer  
> **Note:** The feature this document designs was **not built**. Monarch's `pending` field is not writable, so the design is recorded here for its reasoning only — see [ADR-009](../decisions/009-monarch-pending-field-is-read-only.md) for the verdict and the transferable technique.  

## Deprecated — the feature was abandoned

This document designs a feature that **does not exist and will not be built**. The
investigation it describes concluded that Monarch's `pending` field is read-only,
and the decision to keep the `Pending` tag instead is recorded in
[ADR-009: Monarch's `pending` Field Is Read-Only](../decisions/009-monarch-pending-field-is-read-only.md).

Nothing described below is in `main`. `markerTagQueue`, `pendingStatusSync` and
`postSyncUpdates` were never merged — the exploratory code lives on the tag
`archive/monarch-native-pending-status`. The only surviving change is the
response-body preservation in `src/api/monarch.ts`, and the marker-queue mechanics
remain where they always were, inside `src/services/common/ownerSync.ts`.

The body is left **unedited** below, including the parts written while the outcome
was still uncertain. Read it as a record of how the answer was reached, not as a
description of the system. ADR-009 is the authoritative summary; this is the long
form for anyone who needs the reasoning behind a specific choice.

## Status: Monarch appears to reject the field

The second live run captured the answer. Monarch returns **HTTP 400** for
`updateTransaction` when `pending` is present:

```json
{"errors":[{"message":"Something went wrong while processing: None on request_id: None.",
            "locations":[{"line":1,"column":49}]}]}
```

Column 49 of line 1 is the `$input` variable of the mutation, and the pending pass
sends *only* `{ pending: … }` besides the id — so the field alone is enough to
produce the 400. Note how uninformative the message is: it never mentions
`pending`, which is precisely why classifying failures by their text was doomed.

Getting to that answer took three iterations, and each dead end came from the same
root cause — **the decision rested on interpreting an error message**:

| Version | Behaviour | Failure mode |
|---------|-----------|--------------|
| 7.11.0 | Latched on *any* thrown error | Would blame the field for an auth blip |
| 7.11.1 | Latched only on messages matching a pattern | Refused to blame the field for the very 400 that *was* the field; ownerSync rows then failed outright, and the summary claimed `NOT PROBED` |
| 7.11.2 | **Differential probe** — retry without the field and compare | No message interpretation at all |

Three further flaws surfaced along the way, all fixed in 7.11.2:

1. **`callMonarchGraphQL` discarded the response body on non-200**, so the one
   informative payload in the exchange never reached the code that needed it. This
   blinded *every* Monarch call, not just this feature.
2. **The verdict line lied.** It reported `NOT PROBED` while 23 rows had failed,
   because "probed" was inferred from the latch rather than from whether an attempt
   had been made.
3. **A systemic fault cost one mutation per row.** The latch stops a *field*
   problem after one attempt, but cannot see a fault it never learns about.

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

`updateTransactionWithPending(id, updates, pending, context)` owns every bit of
knowledge about whether the field works. Whether a Monarch field is writable is an
API-level fact, so it belongs in the API client, not in a service.

**Four** outcomes are handled:

1. **Accepted** → one mutation, `pendingApplied: true`.
2. **Rejected by the schema** → trip the latch, **retry once without the field**
   so the caller's real work (notes, owner, amount) still lands.
3. **Silently ignored** (mutation succeeds but the returned `pending` differs from
   what was requested) → trip the latch, `pendingApplied: false`. No retry needed;
   the rest of the update already applied.
4. **Failed for an unrelated reason** (auth, HTTP, network) → do **not** latch and
   do **not** retry; rethrow so the caller reports the genuine failure and the
   field gets a fair test next time.

Case 3 is only detectable because the mutation's response fragment selects
`pending`. Without that check, an ignored field would be indistinguishable from
success.

Cases 2–4 are distinguished by **experiment, not by reading the error text**:

> Send the update with the field. If it fails, send the identical update *without*
> the field. If the second attempt succeeds, the field was the cause.

One variable, one comparison, no dependence on Monarch's wording — which matters
because the real rejection message never mentions `pending` at all. Two earlier
versions tried to classify by pattern-matching and were wrong in both directions.

One refinement keeps an outage from masquerading as a schema verdict: the latch is
only set when the original failure was a **client-side refusal** (4xx, or a
response carrying GraphQL `errors`). A 5xx or network fault whose retry happens to
succeed is recorded `inconclusive` and left **unlatched** — "we broke" says nothing
about the schema. Auth failures short-circuit before the experiment, since
credentials are already cleared and a retry is futile.

The latch (`isPendingFieldSupported()`) is **session-scoped**, not persisted: a
page reload is a free, self-healing re-probe if Monarch adds support later.

**Cost of an unsupported field: exactly one wasted mutation per session.**

### Diagnostics

Because the whole point of this iteration is to *learn* whether the field works,
the verdict is treated as a first-class output rather than a log side-effect.

**A probe record** accompanies every verdict:

```ts
{ verdict: 'supported' | 'rejected' | 'ignored' | 'inconclusive',
  detail,          // verbatim Monarch error, or the requested/returned mismatch
  context,         // which pass probed: ownerSync | pendingStatusSync | rogersReconciliation
  transactionId,
  at }
```

- Exposed in-session via `getPendingFieldProbe()`.
- **Persisted** to `STORAGE.MONARCH_PENDING_FIELD_PROBE` and readable via
  `getPersistedPendingFieldProbe()`, so the answer survives reloads and logouts.
  This is deliberately *not* read as a decision input — only the session latch
  decides behaviour — it exists purely so the evidence cannot be lost again.
- Distinguishing `rejected` from `ignored` matters because the two imply
  completely different next steps.

**Log levels are chosen so the verdict survives a non-debug log level:**

| Event | Level |
|-------|-------|
| Probe attempt (id, fields, requested value) | `debug` |
| **Rejected** — verbatim Monarch error | **`warning`** |
| **Ignored** — requested vs returned | **`warning`** |
| Failure explicitly *not* attributed to the field | `debug` |
| First confirmed success | `info` |
| End-of-stage session verdict | `info` |

`runPostSyncUpdates` closes with one line — `SUPPORTED` / `UNSUPPORTED (…)` /
`PROBE INCONCLUSIVE (…)` / `NOT PROBED` — so there is a single line to read rather
than a log to search. It also *replays the previously persisted verdict* at the
start of the stage, so an answer recorded in an earlier session resurfaces without
anyone having to go looking for it.

`pendingStatusSync` additionally **abandons the pass after three consecutive
failures**. The latch stops a *field* problem after one mutation, but cannot see a
fault it never learns about; without this, a systemic failure cost one mutation per
queued row (23, in the run that exposed it).

**`pendingStatusSync` never overstates its knowledge.** `alreadyUnsupported`
distinguishes "the latch was already tripped before this pass ran" from
`unsupported` ("this pass tripped it"), and the warning cites the recorded verdict,
context and transaction. The misleading line from the first run —
*"Monarch does not accept the pending field"* when the pass had tested nothing —
is now impossible.

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

Sync a Rogers account with a **fresh Monarch session**, then read the single
`info` verdict line:

```
[postSync] Monarch native "pending" field: SUPPORTED | UNSUPPORTED — … | NOT PROBED
```

If `UNSUPPORTED`, the accompanying `warning` line carries Monarch's verbatim error
and names the pass that probed. That text is what decides the next iteration.

Then confirm:

1. A newly-uploaded pending transaction shows as pending in Monarch's UI, not just
   tagged.
2. On settle, the native pending state clears **and** the `Pending` tag is removed.
3. If the field is unsupported: the "Pending status" step reads **"Not supported"**,
   the sync otherwise completes normally, and only **one** wasted mutation appears.
4. Owner sync still applies owners correctly on a Rogers account with owner mapping
   on (the piggyback must not regress it).
5. A second sync with no new data reports "N already pending" and issues no
   mutations.

The verdict is also written to `GM` storage, and **replayed as an `info` line at
the start of the next sync's post-sync stage** — so it resurfaces on its own even
if the console that produced it is long gone.

Note that `GM_getValue` is *not* callable from the page console: `GM_*` APIs exist
only inside the userscript sandbox. Reading the record back therefore happens via
that replayed log line, or via the extension's own storage viewer.

## Where this leaves the feature

The evidence says `pending` is **not writable** via `updateTransaction`. The design
anticipated that: the `Pending` tag remains the source of truth, and every part of
the sync behaves exactly as it did before the feature existed. Nothing is broken by
the answer being "no".

Two honest options for the next iteration:

1. **Probe alternatives once.** A differently-named input field (`isPending`), or a
   dedicated status mutation. The probe machinery now exists, so trying one
   candidate is cheap and the result will be unambiguous.
2. **Accept tag-only and stop.** Mark this doc `Superseded`, keep the
   infrastructure — `markerTagQueue`, `postSyncUpdates`, the response-body fix and
   the differential probe are all valuable independently of this feature — and stop
   guessing at an undocumented API.

The decisive input would be **what Monarch's own web app sends when a transaction's
pending state changes in the UI** — if that is even user-controllable. If the UI
offers no such control, that is strong evidence the field is server-owned and
read-only, which argues for option 2 without further experiments.

## Lesson worth keeping

The recurring mistake was inferring a *fact about a contract* from the *prose of an
error message*. Three attempts failed that way. What finally worked was an
experiment: change one variable, observe the difference. Where behaviour must be
discovered rather than read from documentation, prefer a controlled retry over
pattern-matching, and record the outcome somewhere durable — the answer is easy to
lose and expensive to re-obtain.
