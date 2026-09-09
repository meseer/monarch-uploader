# ADR-008: Monarch's CSV Transaction-ID Matching Does Not Work; Keep Notes-Based Tracking

> **Status:** Accepted  
> **Date:** 2026-09-09  
> **Author:** @meseer  
> **Supersedes:** —  
> **Superseded by:** —  

## Context

Pending reconciliation, deduplication and owner sync all need to answer the same
question: *which source transaction is this Monarch row?* We answer it by writing
a `{prefix}:{hash}` id into the **notes** field and scraping it back out with a
regex.

Monarch's CSV importer looked like it offered a first-class replacement. `id` is
in its list of valid `columnMapping` columns (confirmed by the importer's own
rejection message, quoted in
[cardholder-mapping.md](../design/cardholder-mapping.md)), and its help centre
documents [*"Use transaction IDs to match
transactions"*](https://help.monarch.com/hc/en-us/articles/4409682789908-Importing-Transactions-Manually#h_01K6Y94BW0034W98J2328NXFSP).

Adopting it would have removed the id from user-visible notes, deleted the
notes-scraping regex from three call sites, and very likely retired the whole
marker-tag retention invariant. So we shipped the write half (see
[monarch-native-transaction-ids.md](../design/monarch-native-transaction-ids.md))
and tested whether Monarch actually honours it.

## Decision

**Monarch does not usefully support matching CSV imports on a caller-supplied
transaction id.** We keep the notes-based `{prefix}:{hash}` mechanism as the sole
correlation handle, and we keep sending `importPriority: 'all_transactions'`.

The `Id` CSV column stays — it is inert, costs nothing, and means the data is
already flowing if Monarch fixes this.

## Evidence

Tested against a live account:

1. **Monarch does not appear to retain the id we send.** After an upload it
   reports its own internally-assigned id for the transaction, not the value from
   the CSV's `id` column. With nothing persisted, a later import has nothing to
   match against — which is a sufficient explanation for the rest.
2. **Id-based deduplication does not work — including through Monarch's own UI.**
   Uploading the same transaction twice with an identical `id` produces a
   duplicate. Because this reproduces in Monarch's first-party flow, the defect is
   **upstream**, not in how we construct our request.
3. **Monarch's UI sends `importPriority: "transaction_id_matching"`** in
   `Web_ParseUploadStatementSession`, where we send `all_transactions`. This is
   recorded as a known-unused value; see the trade-off below for why we did not
   adopt it.

Point 2 is what makes this conclusive. Had dedup worked in their UI and not for
us, the difference would have been ours to find.

## Consequences

### Positive
- The notes-based mechanism is **unchanged and remains fully supported**. It
  works, it is well covered by tests, and nothing about it is deprecated by this
  ADR.
- The `Id` column ships anyway, so if Monarch fixes their side, the ids are
  already present on newly uploaded transactions with no further change.
- A `monarch_csv_id_key` runtime kill-switch exists to stop sending the column at
  all, without a rebuild.

### Negative / Trade-offs
- The id stays visible in users' notes for pending transactions. That is the main
  cosmetic cost of the current design and it is not going away yet.
- The notes-scraping regex, and the marker-tag retention invariant that supports
  it, both remain.
- **We deliberately do NOT send `importPriority: 'transaction_id_matching'`.**
  Two reasons: it is unlikely to help, since the bug reproduces in the UI that
  *does* send it; and `all_transactions` is what gives us Monarch's fuzzy
  duplicate detection, which acts as a backstop behind our own
  `uploadedTransactions` store. Trading a working backstop for a broken feature is
  a bad exchange. The value is documented at the call site in
  `src/api/monarch.ts` so it is not "fixed" by a future reader unaware of this.

### Neutral
- Nothing here is irreversible: no data was migrated and no mechanism was removed.
- Phases 2 and 3 of the design doc (settling via CSV, then retiring the notes
  path) are **blocked upstream**, not abandoned.

## If Monarch ships a fix

Re-test in this order, and stop at the first failure:

1. **Does the id round-trip?** Upload a row with a known `id`, then read the
   transaction back. If Monarch still reports its own id, nothing else can work
   and there is no point testing further.
2. **Does dedup work in Monarch's UI?** Import the same row twice by hand. Our
   client cannot be more capable than their own front end.
3. **Only then** try `importPriority: 'transaction_id_matching'` from our code,
   watching for duplicates in case it displaces the fuzzy detection.

Establish each by controlled differential — send the request twice changing
exactly one variable — rather than by interpreting error text. Monarch's failure
responses are frequently generic (`"Something went wrong while processing: None on
request_id: None."`) and cannot be used to attribute a cause.

## Alternatives Considered

| Alternative | Why Rejected |
|-------------|-------------|
| Send `importPriority: 'transaction_id_matching'` now | Unlikely to help — the bug reproduces in Monarch's own UI, which already sends it. Risks losing the fuzzy duplicate detection that `all_transactions` provides as a backstop. |
| Remove the `Id` column again | It is inert and free. Removing it would mean re-doing the work, and the column is what makes a future fix a zero-change win. |
| Retire notes-based tracking anyway and rely on ids | The ids are not retained, so this would break pending reconciliation, dedup and owner sync outright. |
| Keep probing for a working combination of parse-input flags | Unbounded cost against a defect we have localised to Monarch's side. Better to park with the evidence recorded and revisit on a release note. |