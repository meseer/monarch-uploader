# ADR-009: Monarch's `pending` Field Is Read-Only; Keep the `Pending` Tag

> **Status:** Accepted  
> **Date:** 2026-09-18  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

Pending transactions are tracked with a **`Pending` tag**, because Monarch's CSV
importer accepts a `Tags` column but has no column for the platform's own
`pending` field.

The tag works, but it is our convention, not Monarch's. Monarch's UI, filters,
reports and mobile app all understand `pending`; none of them understand a tag
named `Pending`. A transaction that is pending in reality looks settled in every
surface the user actually interacts with.

Monarch's GraphQL API *does* expose `pending`: it is returned by
`getTransactionsList` and selected by the `updateTransaction` mutation's response
fragment. Whether it is **writable** was undocumented and unknown.

## Decision

**`pending` is not writable via `updateTransaction`.** We keep the `Pending` tag as
the sole mechanism for tracking pending transactions.

## Evidence

Sending `pending` in the `updateTransaction` input returns **HTTP 400**:

```json
{"errors":[{"message":"Something went wrong while processing: None on request_id: None.",
            "locations":[{"line":1,"column":49}]}]}
```

Line 1, column 49 is the `$input` variable of
`mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!)`.

Two observations make this conclusive:

1. The failing request carried **only** `{ id, pending }` — no other fields — so
   nothing else can account for the rejection.
2. The **identical request without `pending`** returned HTTP 200 and applied its
   other changes successfully.

The response also *returns* `"pending": false`, consistent with a server-owned,
read-only field derived from the institution feed.

## Consequences

- The `Pending` tag remains the source of truth: written by the CSV import, used
  to find pending transactions, removed by reconciliation on settlement.
- Monarch's native pending indicator will not reflect our pending transactions.
  Accepted as a platform limitation.
- One change from the investigation is retained on its own merits: **the Monarch
  API client no longer discards the response body on non-200 responses.** See
  *Method* below for why that mattered.

Rejected alternatives:

- **Guessing at other field names** (`isPending`) or hunting for a dedicated
  mutation — speculative, and each attempt costs a round of live testing. Revisit
  only with evidence, ideally by observing what Monarch's own web app sends when a
  transaction's pending state changes in the UI. If the UI offers no such control,
  that is strong evidence the field is server-owned and the question is closed.
- **Keeping the exploratory infrastructure** (a pending-status sync pass, a shared
  marker-tag queue, a post-sync pass registry) — all built during the
  investigation, all with exactly one consumer once the feature was dropped. Left
  in git history rather than carried in `main` as speculative abstraction. The
  marker-queue mechanics remain documented where they are actually used, in
  `src/services/common/ownerSync.ts`.

## Method: why this took three attempts

Worth recording, because the mistake is easy to repeat.

Each attempt tried to decide *whether the field was the problem* by
**interpreting the error message**:

| Attempt | Rule | Outcome |
|---------|------|---------|
| 1 | Treat any thrown error as proof the field is unsupported | Would blame the field for an auth expiry or network blip |
| 2 | Treat only errors whose text matches a pattern as proof | Refused to blame the field for the actual 400 — whose message never mentions `pending` — and broke an unrelated code path that depended on the retry |
| 3 | **Retry without the field and compare** | Correct |

The message here is entirely generic ("Something went wrong while processing"), so
no amount of pattern-matching could have worked. What settled it was a controlled
experiment: send the request twice, changing exactly one variable, and compare.

Two supporting lessons:

- **Do not discard diagnostic payloads.** `callMonarchGraphQL` rejected non-200
  responses with only the status code, throwing away the GraphQL `errors` array —
  including the `locations` entry that identified the offending part of the query.
  That is the one piece of information the whole question turned on, and it had to
  be recovered by reading the browser console by hand. Now fixed.
- **Bound the cost of an unknown.** An early version issued one failing mutation
  per queued transaction (23 in one run) because nothing recognised that the
  failure was systemic rather than per-row.

## Probing an undocumented Monarch field

The verdict above is specific to `pending`, but the technique generalises, and
Monarch's API has more undocumented corners — see
[Native Monarch Transaction IDs](../design/monarch-native-transaction-ids.md),
whose later phases are blocked on the same class of unknown. The recipe, for the
next time a field's writability has to be discovered rather than read:

1. **Decide by differential experiment, never by error text.** Send the update
   with the field; if it fails, send the identical update without it. If the second
   attempt succeeds, the field was the cause. One variable, one comparison.

2. **Check for silent acceptance, not just rejection.** A mutation can return
   HTTP 200 and simply ignore the field. This is only detectable because the
   mutation's response fragment selects the field back, so the requested value can
   be compared against the returned one — `updateTransaction` pulls in
   `TransactionOverviewFields`, which selects `pending`. Without that comparison an
   ignored field is indistinguishable from success. *Rejected* and *ignored* imply
   completely different next steps, so they are worth distinguishing.

3. **Only conclude "unsupported" from a client-side refusal.** Trip that conclusion
   on a 4xx, or on a response carrying a GraphQL `errors` array. A 5xx or network
   fault whose retry happens to succeed is **inconclusive** — "we broke" says
   nothing about the schema. Without this rule an outage masquerades as a schema
   verdict. Auth failures should short-circuit before the experiment runs at all,
   since credentials are already cleared and a retry is futile.

4. **Keep the conclusion session-scoped, not persisted.** A page reload then
   becomes a free, self-healing re-probe if Monarch adds support later. Persist the
   *evidence* if it is expensive to re-obtain, but do not let a persisted verdict
   decide behaviour.

5. **Bound the blast radius separately from the verdict.** A latch on a *field*
   cannot see a *systemic* fault it never learns about, so also abandon a pass
   after a few consecutive failures. This is what the 23 wasted mutations bought.

## References

- Live evidence: HTTP 400 vs 200 differential, Rogers Bank sync, 2026-09-07
- Exploratory work: tag `archive/monarch-native-pending-status` (unmerged)
- Full design of the abandoned feature, kept as `Deprecated`:
  [Monarch-Native Pending Status](../design/monarch-native-pending-status.md)
- Retained fix: response-body preservation in `src/api/monarch.ts`
