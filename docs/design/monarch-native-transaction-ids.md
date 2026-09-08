# Native Monarch Transaction IDs

> **Status:** Draft  
> **Updated:** 2026-09-09  
> **Author:** @meseer  
> **Note:** Phase 1 (write ids) is implemented. **Phases 2–3 are BLOCKED upstream** — see [ADR-008](../decisions/008-monarch-csv-transaction-id-matching-does-not-work.md). Supersedes the *"Use Monarch's transaction-ID matching instead of scraping notes"* follow-up item in [cardholder-mapping.md](cardholder-mapping.md).

> ## ⚠️ Parked — Monarch's id matching does not work
>
> Live testing (2026-09-09) established that **Monarch does not retain the id we
> send**: after an upload it reports its own internally-assigned id, and id-based
> deduplication fails **even through Monarch's own UI**. The defect is upstream.
>
> **The notes-based `{prefix}:{hash}` mechanism remains the live, fully supported
> correlation handle and is not deprecated.** Phases 2–3 below are on hold until
> Monarch fixes their side. The `Id` column keeps shipping (inert, free, ready if
> they do).
>
> Full evidence, the reasoning for keeping `importPriority: 'all_transactions'`,
> and the re-test order if a fix lands: **[ADR-008](../decisions/008-monarch-csv-transaction-id-matching-does-not-work.md)**.

Pending reconciliation, deduplication and owner sync all need to answer the same
question: *which source transaction is this Monarch row?* Today they answer it by
writing a `{prefix}:{hash}` id into the **notes** field and scraping it back out
with a regex.

Monarch's CSV importer accepts an **`id` column** and supports
[*"Use transaction IDs to match transactions"*](https://help.monarch.com/hc/en-us/articles/4409682789908-Importing-Transactions-Manually#h_01K6Y94BW0034W98J2328NXFSP).
`id` is confirmed present in its list of valid columns — from the importer's own
rejection message:

```
Invalid column mapping: 'owned_by_user' is not a valid column.
Valid columns: ['account', 'amount', 'category', 'data_provider_description',
                'date', 'id', 'merchant_name', 'notes', 'tags']
```

That is a first-class, platform-supported correlation handle, and replacing the
notes hack with it would:

- remove the id from user-visible notes;
- remove the notes-scraping regex from reconciliation, owner sync and dedup;
- likely remove the need to retain the id at all — and with it the whole
  [marker-tag retention invariant](cardholder-mapping.md#marker-tag-retention-invariant).

---

## The key framing: the Id column *is* the notes id, promoted

Phase 1 invents no new identifier. Every integration already computes a stable,
namespaced id and writes it into the notes:

| Integration | id | Source |
|---|---|---|
| Rogers Bank | `rb-tx:{hash16}` | `txHashId` / `pendingId` |
| MBNA | `mbna-tx:{hash16}` | `txHashId` / `pendingId` |
| Wealthsimple | `ws-tx:{id}` | `getTransactionId()` → `externalCanonicalId` ?? `canonicalId` ?? `generated:…` |

The `Id` column carries **exactly that string**. Two consequences, both
deliberate:

- **No new id-stability risk.** Whatever correlation properties the notes id has
  today, the column has identically. A second identifier would mean two things to
  keep in sync and two migrations later.
- **The Wealthsimple settlement-suffix problem is not new.** It is the existing
  problem that `services/wealthsimple/transactionIdMatching.ts` already solves,
  and the column reuses that same solution (see question 5 below) rather than
  inventing a second answer to it.

Two deliberate asymmetries between the column and the notes:

1. **Gating.** `resolveNotesTransactionId` gates settled rows on
   `ownerSyncPending`, so notes stay byte-identical for users who have not opted
   into owner mapping. The `Id` column has no such constraint — Monarch reads it
   as a column rather than displaying it — so it is written unconditionally.
2. **Which id, for Wealthsimple.** The column carries the id the transaction was
   first *uploaded* under; the notes keep the current one. See question 5.

The notes rules themselves are untouched.

### Why MBNA uses the hash and not its `referenceNumber`

MBNA *does* have a stable institution id — but only once a transaction has
settled. **While pending, `referenceNumber` is the literal string `"TEMP"`**, which
is how `isPendingTransaction` identifies pending rows in the first place.

That makes it unusable as the `Id` column value:

- it is identical across every pending transaction, so it is not an identifier;
- it **changes** at settlement (`"TEMP"` → the real number), which is precisely
  the property an id used for matching must not have.

The `mbna-tx:{hash16}` hash is computed from fields that do not change across
settlement (date, sanitized description, amount, card `endingIn`), so it is the
same value before and after. `referenceNumber` remains the **dedup** key for
settled rows (`getSettledRefId`), which is a different question — dedup only ever
compares settled ids to settled ids, never one to the other.

---

## Open questions — mostly answered, unfavourably

**How they get answered matters.** Monarch's failure responses are frequently
generic ("Something went wrong while processing: None on request_id: None."), so
no amount of reading an error message can establish whether a particular field is
the cause. The only reliable method is a controlled differential: send the request
twice, change exactly one variable, and compare.

| # | Question | Status |
|---|---|---|
| 1 | Does matching need an explicit parse-input flag? | **Answered.** Monarch's UI sends `importPriority: "transaction_id_matching"`; we send `all_transactions`. But since dedup fails in their UI too, this is not the missing piece — and we keep `all_transactions` deliberately, because it buys us fuzzy duplicate detection as a backstop. See ADR-008. |
| 2 | Is the stored id readable back via GraphQL? | **Answered: no.** Monarch reports its own internally-assigned id for the transaction, not ours. This is the root cause: nothing is persisted for a later import to match on. |
| 3 | What does an id-matched re-upload actually update? | **Moot** while (2) holds — there is no match to act on. |
| 4 | What is the uniqueness scope — account or household? | **Moot** for the same reason. Our hash ids include card/account-distinguishing fields, so a collision was never a practical concern. |
| 5 | Does Wealthsimple expose a settlement-stable id? | **Sidestepped, not answered** — and no longer blocking. See below. |

### Question 5: the Wealthsimple id

`externalCanonicalId` is the provider's id and gains an extra dash-separated
segment when card activity settles:

```
pending: card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS
settled: card-activity-00000000527000993851-VI-00-0306231535741989-QIRIAS-0tk4pfcsob83
```

Matching needs an id that is byte-identical either side of settlement.

**Phase 1 does not wait for an answer.** It sidesteps the question entirely by
writing the id the transaction was **first uploaded under** rather than its
current id:

```
Id column = findMatchingUploadedId(uploadedTransactionIds, tx.id) ?? tx.id
```

`findMatchingUploadedId` is the same variant-aware lookup that pending
reconciliation already uses, so both paths agree on what "the same transaction"
means. This is correct by construction rather than by luck: the Monarch row was
*created* with the pending-era id, so that is the only value an `id` match could
possibly hit. A transaction never seen before falls back to its own id, which is
also what created its row.

Two consequences worth noting:

- It needs no stable provider field, so no integration's `Id` column is left
  incorrect. (Phase 2 is blocked, but on Monarch's side — not on this.)
- The **notes** keep the *current* id, unchanged. Pending reconciliation resolves
  the variant itself and must not be disturbed while it remains the live
  mechanism — which, per ADR-008, is indefinitely.

The lookup is injected as a `resolveUploadedId` callback rather than imported,
because it needs the account's dedup store and `utils/` may not import from
`services/`.

**Still worth answering** (the diagnostics in
`services/wealthsimple/transactionsReconciliation.ts` log candidate fields
whenever a pending id resolves to a *different* settled id): if some field —
`canonicalId`, `groupId`, `reference` — turns out to be genuinely stable, the
callback could be dropped for something simpler. Prior expectation, to be
confirmed or refuted: `canonicalId` is Wealthsimple's own feed-item id, and the
pending and settled records may well be *different feed items*, in which case it
is not stable either.

---

## Phases

### Phase 1 — write ids (implemented)

Purely additive. Notes, tags, reconciliation, owner sync and dedup are all
unchanged; if Monarch ignores the column entirely, nothing about current
behaviour differs.

| File | Change |
|---|---|
| `src/core/transactionIds.ts` *(new)* | `resolveMonarchTransactionId()` — one rule for deriving the column value |
| `src/core/config.ts` | `MONARCH_CSV_ID_FIELD_KEY = 'id'`; `STORAGE.MONARCH_CSV_ID_KEY` runtime kill-switch |
| `src/utils/csv.ts` | `Id` appended to `MONARCH_CSV_COLUMNS`; `MONARCH_CSV_COLUMNS_WITHOUT_ID`; `extractCSVHeaderColumns()`; `buildMonarchColumnMapping(columns?)`; `Id` emitted by the Rogers and Wealthsimple converters |
| `src/api/monarch.ts` | `columnMapping` derived from the uploaded CSV's header row |
| `src/services/common/syncOrchestrator.ts` | `Id` emitted — **this is MBNA's live path**, and every future modular integration's |
| `src/services/wealthsimple/account.ts` | Passes `resolveUploadedId` so the Id column uses the pending-era id |
| `src/services/wealthsimple/transactionsReconciliation.ts` | Id-stability diagnostics (debugLog only) |
| `src/integrations/mbna/sinks/monarch/csvFormatter.ts` | `Id` + `Owner` added, for consistency (no production caller — see below) |

**MBNA emits an `Id`** via `syncOrchestrator`, which is its live sync path.
`integrations/mbna/sinks/monarch/csvFormatter.ts` has **no production caller**
(only tests), but it now emits the same canonical column set anyway — a formatter
that silently omits columns is a trap for whoever wires it up next. The
header-derived `columnMapping` means either column set uploads correctly.

**Questrade and Canada Life emit no `Id` column.** Neither has an id that is
stable across the pending → settled transition, and emitting an *empty* id would
hand Monarch a blank match key on every row — unverified behaviour. Omitting the
column is the conservative choice; their CSV output is byte-identical to before.

#### The index-drift fix, and why it was required first

`buildMonarchColumnMapping` maps Monarch field names to **column indices**. It
used to derive them from the `MONARCH_CSV_COLUMNS` constant — but formatters
maintain their own column lists, and two of them were shorter: 8 columns, no
`Owner` (`services/canadalife/csvFormatter` still is; MBNA's has since been
brought in line).

That was safe only by accident: `Owner` is unmapped, so the highest mapped index
was 7 and stayed within every column list. Appending `Id` would have mapped
`id → 9` for CSVs that only have 8 columns — silently corrupting those uploads.
Canada Life's formatter is exactly that case, and is why this had to be fixed
rather than worked around.

The mapping is now derived from the **actual header row of the CSV being
uploaded**, with the canonical list as a fallback. This makes the entire class of
drift impossible rather than merely unlikely, and lets integrations vary their
column set freely. It is also what makes the Questrade omission above safe.

#### Kill-switch

```js
GM_setValue('monarch_csv_id_key', '')   // stop mapping Id — no rebuild needed
```

The column is still emitted (harmless, unmapped columns are ignored) but Monarch
never reads it. It exists so the column can be withdrawn instantly if it ever
turns out to cause harm — which, given Monarch currently ignores the id
entirely (ADR-008), it does not today.

### Phase 2 — CSV settlement + verification (BLOCKED)

> **Blocked upstream.** Monarch does not retain the id, so an id-carrying
> re-upload has nothing to match against. Do not start this before re-confirming
> the round-trip — see the re-test order in
> [ADR-008](../decisions/008-monarch-csv-transaction-id-matching-does-not-work.md).

Kept for when that changes. Merged deliberately: a meaningful verification
requires a **second upload carrying the same id**, which is the settlement
mechanism itself. There is no smaller experiment that answers questions 1–3.

Behind a per-account setting, default off, so it can be enabled on one account
first.

1. **Readback probe** — try candidate GraphQL fields for question 2.
2. **Settlement re-upload** — same `Id`, settled amount/date/merchant, `Tags`
   without `Pending`, `Notes` **without** the `{prefix}:{hash}`. Notes cleanup
   falls out of the CSV update rather than needing its own mutation.
3. **Differential** — re-upload one unchanged row and compare: duplicate, or
   match? Then check whether notes/tags/amount were actually applied.
4. **The existing notes/GraphQL reconciliation keeps running, untouched.** Both
   paths are idempotent, so whichever settles a transaction first wins and the
   other becomes a no-op. This is the point of keeping both: the CSV path can
   fail silently and no user-visible behaviour regresses.

Outcome recorded as an **ADR** (next free number), stating the differential
evidence rather than a conclusion drawn from error text.

### Phase 3 — retire the notes path (BLOCKED)

> **Blocked behind Phase 2.** The notes path is currently the *only* working
> correlation mechanism — removing it now would break pending reconciliation,
> dedup and owner sync outright.

Only after Phase 2 has run clean for several syncs on real data:

- dedup and owner-sync correlation move to native ids;
- notes stop carrying ids;
- the marker-tag retention invariant and `shouldRetainTxIdInNotes` are removed;
- `extractPendingIdFromNotes` / `cleanPendingIdFromNotes` / `stripTxIdFromNotes`
  and the WS diagnostics are deleted.

Migration: transactions uploaded before Phase 1 have an id in their notes but
none in Monarch's `id` field. Either they are backfilled by an id-carrying
re-upload, or the notes path is retained read-only for one retention window
(91 days by default) and then dropped. To be decided with Phase 2 evidence.

---

## Invariants

- **Never map a column index that the uploaded CSV does not have.** Derive the
  mapping from the CSV's own header row. This is what makes per-integration
  column sets safe.
- **The `Id` column and the notes id must carry the same string.** Both come from
  the same per-transaction fields; `core/transactionIds` owns the column rule and
  `core/markerTags` owns the notes rule. Divergence would make Phase 3's
  migration unanalysable.
- **Do not emit an empty `Id`.** An integration with no stable id omits the
  column entirely rather than sending a blank match key.
- **The `Id` column must be the id Monarch's row was CREATED with**, not
  necessarily the transaction's current id. Wealthsimple mutates ids at
  settlement, so these differ; `resolveUploadedId` is what reconciles them.
- **Phase 1 must remain behaviourally inert.** Notes, tags, dedup and
  reconciliation are unchanged; only a new column is added.
- **Keep the notes path until native matching is proven.** Both paths run
  together through Phase 2 precisely so a silent failure of the new mechanism
  cannot regress anything.

---

## Rejected alternatives

**A new, purpose-built id for the column.** Cleaner in the abstract, but it means
two identifiers per transaction that must agree, and two migrations at Phase 3
instead of one. Reusing the notes id makes the column provably equivalent to what
already works.

**Special-casing the `Id` index instead of deriving the mapping from the header.**
Would have been a smaller diff, but it leaves the underlying trap in place: the
next column anyone appends re-introduces the same silent corruption for the
8-column formatters. Fixing the mechanism is cheaper than remembering the hazard.

**Verifying before implementing (a standalone Phase 2 ahead of Phase 1).**
Attractive, but the only meaningful test requires uploading rows that carry ids —
which is Phase 1. Writing ids is inert, so there is no risk in doing it first.

**Emitting an empty `Id` for Questrade/Canada Life for column-set uniformity.**
Uniformity is not worth handing Monarch a blank match key on every row when the
matching semantics are unverified. Header-derived mapping makes the non-uniform
column sets safe anyway.

**Dropping the notes path at Phase 2.** Would leave no fallback if native
matching turns out to be partial (e.g. amount-only updates, per question 3).
Running both is nearly free because each is idempotent.