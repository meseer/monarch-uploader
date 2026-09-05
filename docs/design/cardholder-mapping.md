# Cardholder → Monarch Owner & Tag Mapping

> **Status:** Active  
> **Updated:** 2026-09-04  
> **Author:** @meseer  
> **Note:** Implements [issue #165](https://github.com/meseer/monarch-uploader/issues/165). Owner mapping and cardholder tagging are both opt-in and off by default.

Credit cards with multiple authorized cardholders produce a single transaction
feed, so in Monarch there is no way to tell who spent what. This design maps the
institution-reported cardholder to Monarch's native **Owner** field, and
optionally to a **tag**, using one generic service shared by every integration.

---

## Monarch-side constraints

### The CSV importer has no owner column — definitively

**Do not try to map an owner column again.** It is not a matter of finding the
right key name; the column does not exist. Any attempt fails the entire upload:

```
Invalid column mapping: 'owned_by_user' is not a valid column.
Valid columns: ['account', 'amount', 'category', 'data_provider_description',
                'date', 'id', 'merchant_name', 'notes', 'tags']
```

That list is exhaustive and contains no owner field under any name. An *unmapped*
column is silently ignored, but an *invalid key* is rejected — which is why this
is a hard failure rather than a silent no-op.

Consequences:

- `MONARCH_CSV_OWNER_FIELD_KEY` is `''`, so `Owner` is never sent in
  `columnMapping`. The override plumbing behind `STORAGE.MONARCH_CSV_OWNER_KEY`
  is retained *only* so this closed avenue can be cheaply re-probed if Monarch
  ever adds the column.
- The `Owner` CSV column is still emitted, but purely as human-readable context
  for anyone inspecting the generated file. Monarch never reads it.
- The owner is applied **after** upload, by `services/common/ownerSync`.

### Owner is set by GraphQL, not by import

`updateTransaction(id, { ownerUserId })` uses
`Web_TransactionDrawerUpdateTransaction` — the same mutation Monarch's own UI
uses — so the owner is set with a stable, supported call. The cost is one request
per transaction, which is why the pass is capped per sync (see
`OWNER_SYNC_MAX_UPDATES_PER_SYNC`).

Because the owner is now applied by ID, `monarchUserId` is the load-bearing
field and `monarchUserName` is only a display label. (Under the earlier CSV
design the *name* was load-bearing, since Monarch matched the column against
`users[].name` and silently reverted anything unrecognised. That constraint no
longer applies.)

---

## Two independent features

| Feature | Setting | Default | Values |
|---------|---------|---------|--------|
| Owner mapping | `cardholderOwnerMode` | `off` | `off` \| `on` |
| Cardholder tag | `cardholderTagMode` | `off` | `off` \| `auto` \| `always` |

Both default to **off**, so no existing user sees any change until they opt in.
The two are independent — Owner alone, tag alone, both, or neither are all valid.

- **Owner `on`** — queues a post-upload owner update for every transaction whose
  cardholder resolves to a household member. Cardholders that are unmapped or
  explicitly Shared are **not** queued: there is no owner to apply, so marking
  them would strand a marker tag forever.
- **Tag `auto`** — tags only once **two or more** cardholders have ever been
  discovered for the account (see below). **`always`** — always tags.

When owner mapping is `off`, no marker tag is emitted and the notes are
byte-identical to the pre-feature output. This is enforced by test, because it is
the property that keeps the feature invisible to users who have not opted in.

---

## Post-upload owner sync

### Correlation

The upload gives us nothing to correlate on: the response contains only
`uploadedStatement { id, transactionCount }` — no per-transaction ids — and
`getTransactionsList` has no statement-id filter. So the CSV writes two handles
into each affected row:

| Handle | Purpose |
|--------|---------|
| `pendingOwnerUpdate` marker tag | how the pass **finds** the rows |
| `{prefix}:{hash}` id in the notes | how the pass **identifies** which source transaction each row is |

The id was previously written for pending rows only. Settled rows now get it too
when an owner update is queued — otherwise a transaction that settled before its
first upload could never be matched back to its cardholder. This is gated on the
owner marker so nothing changes for users who have not opted in.

### Step order

```
credit limit → fetch Monarch pending → fetch source → reconcile
            → upload → ownerSync → balance
```

Owner sync runs **after upload in the same sync**, deliberately. Deferring it to
the next sync would be simpler but would leave every newly uploaded transaction
unattributed until the following run.

### The pass

1. Skip entirely unless `cardholderOwnerMode === 'on'`.
2. Resolve the `pendingOwnerUpdate` tag, with a short bounded retry (see below).
3. `getTransactionsList({ accountIds, tags: [markerTagId], startDate, endDate })`
   over the retention window.
4. Match each row to a source cardholder via the id in its notes.
5. **Skip any row that already has an owner** — never overwrite a manual choice.
   This is also what makes the pass idempotent.
6. One `updateTransaction` per row: set `ownerUserId`, drop the marker tag
   (preserving all others), and apply the retention rule to the notes.
7. Anything unmatched keeps its marker and is retried next sync.

### Marker-tag retention invariant

> Keep the `{prefix}:{hash}` id in the notes while **any** marker tag is present.
> Strip it only when the last marker is removed.

Marker tags are `Pending` and `pendingOwnerUpdate`. `core/markerTags` owns both
halves of this rule — `resolveNotesTransactionId` (when to write an id) and
`shouldRetainTxIdInNotes` (when to keep one) — so the two cannot drift apart.

Two properties follow, and both were failure modes in earlier drafts:

- **Crash-safe.** A transaction whose follow-up was interrupted keeps both its
  marker and its id, so a later sync finds it and finishes the work. An earlier
  in-memory handover design was rejected precisely because it could not survive
  a partial failure.
- **Order-independent.** Reconciliation and owner sync can run in any order, in
  any sync, without knowing about each other. Each only asks "are any markers
  left?".

This is why reconciliation no longer strips the id unconditionally at settlement.
That is not owner-mode awareness leaking into reconciliation — it is a local
question about tags reconciliation already computes.

### The resolver must span the whole fetch window

The owner-id map is built from **all** fetched transactions, not just the ones
being uploaded this sync. The marker-tag queue legitimately holds rows from
earlier syncs — deferred by the batch cap, previously unmatched, or interrupted
mid-pass — and building the resolver from new uploads alone would leave those
permanently unresolvable and stuck with their marker, defeating the entire
self-healing design. This mirrors the same reasoning that makes cardholder
*discovery* read all fetched transactions.

### Batch cap

`OWNER_SYNC_MAX_UPDATES_PER_SYNC` (200) bounds the mutations per sync. A first
sync can queue hundreds; the remainder is deferred to the next sync, which is
safe because the marker tag *is* the queue.

### Marker-tag visibility on the first sync

The very first owner sync runs seconds after the import that **created** the
`pendingOwnerUpdate` tag, and `getTagByName` is not guaranteed to see it
immediately. The lookup therefore retries a small bounded number of times before
giving up.

Failing after those attempts is still safe — the rows keep their marker and are
picked up next sync — so the retry stays deliberately short rather than blocking
the sync. Worst case is degraded (one sync of attribution lag), never broken.

---

## Auto-mode tracking

`auto` is driven by a **cumulative, persisted** cardholder map on the
consolidated account entry — never by the contents of the current sync window.

Order of operations per sync:

1. **Discover** cardholders from **all** fetched transactions (not just the new,
   post-dedup ones).
2. **Merge** additively into the persisted map and save.
3. **Decide** `shouldTag` from the *merged* map.
4. **Resolve** owner/tag values and annotate transactions for the CSV stage.

Three properties follow from this ordering, each of which was a real failure mode
in earlier drafts:

- Discovering from *all* fetched transactions means a second cardholder is found
  even when every one of their transactions was uploaded on a previous sync.
- Merging *before* deciding means the very first sync that sees cardholder #2
  already tags — no one-sync lag.
- Using the *persisted* map means a narrow sync window containing only one
  cardholder does not flip tagging back off.

| Situation | Merged map size | Outcome in `auto` |
|-----------|-----------------|-------------------|
| Single cardholder (most users) | 1 | No tag. CSV identical to today. |
| Second card appears | 2 | Tags from that sync onward. |
| Window contains one holder, two known | ≥2 | Still tags (no flip-flop). |

**Previously uploaded transactions are never re-tagged or re-owned.** Re-tagging
history would require matching Monarch transactions heuristically by date +
amount + merchant; that is deliberately out of scope.

---

## Storage schema

Stored on the consolidated account entry (per the integration-consistency rules —
no new top-level GM keys):

```js
{
  cardholderOwnerMode: 'off',        // 'off' | 'on'
  cardholderTagMode: 'off',          // 'off' | 'auto' | 'always'
  cardholders: {
    // Keyed by the RAW institution name so the key is stable
    'MYKHAILO DELEGAN': {
      label: 'Mykhailo Delegan',           // title-cased; drives the TAG only
      cardLast4: '8584',                   // display / disambiguation
      firstSeen: '2026-09-04',
      monarchUserId: '162625044845828370', // the value actually assigned; null when Shared/unresolved
      monarchUserName: 'Mykhailo Delegan', // display label only
      isShared: false,                     // true = user explicitly chose Shared
      matchType: 'manual'
    }
  }
}
```

Two fields deserve explanation:

- **`isShared`** distinguishes "the user deliberately chose Shared" (do not
  prompt again) from "never asked" (do prompt). Neither is queued for an owner
  update, but only one suppresses the prompt.
- **`monarchUserId` is what gets assigned; `monarchUserName` is only a label.**
  The owner is set by ID via GraphQL, so a household rename cannot break the
  assignment. The cached name is still refreshed from the live household list each
  sync so the settings UI never shows a stale name, and if the mapped member has
  left the household entirely the entry reverts to unresolved — which stops it
  being queued at all.

---

## Matching and prompting

`services/common/cardholderMatching.ts` is pure and only ever produces a
*suggestion*; it never persists. Strategies, in confidence order:

1. `exact-name` — normalized cardholder name equals member `name`
2. `exact-display` — equals member `displayName`
3. `initial` — first name + last initial, comparable in either direction
   (`"MYKHAILO D"` ↔ `"Mykhailo Delegan"`)
4. `first-name` — first names match **and exactly one member matches**

Normalization is case-insensitive with whitespace collapsed, so the common case
(`"MYKHAILO DELEGAN"` → `"Mykhailo Delegan"`) matches without user input.

**Ambiguity is never resolved by guessing.** If two members share a first name,
strategies 3 and 4 return no match rather than picking one.

The user confirms every mapping via `showCardholderSelector`, prompted **once per
cardholder** when owner mapping is on and the cardholder has no persisted
mapping. Options are **Shared** plus every household member, with the suggestion
pre-selected and labelled — so the common case is a single click.

Cancelling the prompt (button or Escape) leaves the cardholder unmapped and
**unpersisted**, so the user is asked again next sync rather than being silently
locked into a wrong mapping.

---

## Architecture

The per-integration surface is deliberately tiny — a ~10-line extractor:

```ts
interface CardholderInfo { name: string; cardLast4?: string | null }
type ExtractCardholderHook = (tx) => CardholderInfo | null;
```

Everything else is shared:

| Concern | Location |
|---------|----------|
| Name formatting/normalization | `src/core/utils.ts` (`toTitleCase`, `normalizePersonName`) |
| Household members API | `src/api/monarchHousehold.ts` |
| Matching strategies (pure) | `src/services/common/cardholderMatching.ts` |
| Discovery, merge, resolution | `src/services/common/cardholders.ts` |
| CSV columns + tag builder | `src/utils/csv.ts` (`MONARCH_CSV_COLUMNS`, `buildMonarchTags`) |
| Marker tags + notes-id retention rule | `src/core/markerTags.ts` |
| Post-upload owner assignment | `src/services/common/ownerSync.ts` |
| Mapping prompt | `src/ui/components/cardholderSelector.ts` |
| Settings widget | `src/ui/components/settingsModalCardholders.ts` |

`markerTags` lives in `core/` rather than `services/` on purpose: `utils/csv.ts`
needs the notes-id rule, and `utils` may not import from `services`. Keeping it in
`core` makes every consumer's import legal.

### Per-integration extractors

| Integration | Name field | Card field | File |
|-------------|-----------|-----------|------|
| Rogers Bank | `name.nameOnCard` | `cardNumber` (masked) | `src/services/rogersbank/cardholderExtractor.ts` |
| MBNA | `cardHolderName` | `endingIn` (bare digits) | `src/integrations/mbna/source/cardholderExtractor.ts` |

Rogers confirmed to include both fields on **PENDING and APPROVED** activities.

### Wiring

- **Modular integrations (MBNA)** — one optional `extractCardholder` SyncHook.
  `syncOrchestrator` calls `syncCardholders` then `applyCardholderFields`, so any
  future modular integration opts in with one extractor plus two manifest lines.
- **Legacy integrations (Rogers Bank)** — `rogersbank-upload.ts` calls the same
  service functions directly. When Rogers migrates to the modular architecture
  these call sites collapse into the hook with no logic moving.

Household members are fetched **once per sync, lazily** — only when
`hasCardholders` is set, owner mapping is on, and at least one cardholder needs
resolving or refreshing. **A fetch failure is non-fatal**: it is logged, no owner
updates are queued for this sync, and the sync continues.

The owner sync step itself is likewise non-fatal end to end — a whole-pass
failure, a per-row failure, and a missing marker tag are all logged and skipped.
Owner sync can never abort a sync.

### De-duplication of existing code

`MONARCH_CSV_COLUMNS` was previously duplicated in `utils/csv.ts` and
`syncOrchestrator.ts`; it is now exported from `csv.ts` and imported by the
orchestrator. The Tags expression was duplicated three ways (Rogers converter,
orchestrator converter, `resolveWealthsimpleTags`); all three now use
`buildMonarchTags`, which also gives every integration multi-tag support in one
place. Net reduction in duplication.

---

## Invariants

These must not be broken by future changes:

- **The cardholder name is never added to pending-transaction ID hashing.**
  Rogers already hashes `cardNumber` and MBNA already hashes `endingIn`, so cards
  are already differentiated. Adding the name would invalidate every stored
  `rb-tx:` / `mbna-tx:` hash and cause mass duplicate uploads.
- **Never send `Owner` in `columnMapping`.** Monarch rejects the whole upload; see
  the constraints section above for the exact error.
- **Never overwrite an owner a user set manually.** The owner sync pass skips any
  row where `ownedByUser` is already populated, which is also what makes it
  idempotent.
- **The notes id survives while any marker tag remains.** Both halves of that rule
  live in `core/markerTags`; any new marker tag must be added to `MARKER_TAGS` so
  the rule keeps covering it.
- **Only queue an owner update when one can actually be applied.** A row with no
  resolved `monarchUserId` must not get the marker, or it would keep the marker
  (and the id in its notes) forever.
- **Both settings stay `off` by default**, so users who have not opted in see no
  behaviour change and byte-identical CSV output.

---

## Rejected alternatives

**MBNA's `/waw/mbna/{account}/cardholders` endpoint.** MBNA can enumerate every
authorized cardholder on an account. We deliberately do not call it: an
authorized user who never transacts would still be listed, which would flip
`auto` tagging on for an account that is single-user in practice. Deriving
cardholders from transactions gives the intended behaviour and avoids an extra
HTTP call plus a second code path. Rogers has no equivalent endpoint, so
transaction-derived discovery is also the only uniform approach.

**The `Owner` CSV column.** This was the original design and it does not work —
Monarch's importer has no such column and rejects the upload outright. See the
constraints section for the error. Superseded by the post-upload GraphQL pass.

**In-memory handover from upload to owner sync.** Passing the uploaded rows
directly to the owner pass in memory would avoid the marker tag entirely, but it
cannot survive a partial failure: an interrupted sync would leave transactions
permanently unattributed with nothing recording that work was outstanding. The
marker tag makes the queue durable, which is the whole point.

**Deferring owner sync to the next sync.** Simpler to implement — the marker tag
already makes it safe — but it would leave every newly uploaded transaction
unattributed until the following run. Running in the same sync after upload costs
nothing extra and avoids the lag.

**Tag-only (no Owner).** The original issue asked for a tag, but Monarch's native
Owner field is semantically correct and filterable/reportable in ways a tag is
not. Both are supported so users who prefer tags — or who have authorized users
outside their Monarch household — are still served.

---

## Known limitations

- **Owner requires a matching Monarch household member.** Authorized cardholders
  who are not household members can never be mapped and are never queued for an
  owner update. This is surfaced in the settings widget rather than hidden.
- **One GraphQL request per transaction.** Unavoidable given the importer has no
  owner column. Bounded by `OWNER_SYNC_MAX_UPDATES_PER_SYNC` per sync.
- **First-sync attribution may lag by one sync.** Only if the
  `pendingOwnerUpdate` tag has not propagated by the time the pass runs, and only
  until the next sync. Degraded, never broken.
- **No historical backfill.** Transactions uploaded before the feature was
  enabled (or before a second cardholder appeared) keep their original empty
  Owner and no tag.
- **MBNA pending transactions are unverified.** `cardHolderName` is confirmed on
  settled MBNA rows; if it is absent on pending rows, those upload with `Shared`
  and keep it through settlement (reconciliation preserves tags but does not add
  them). The extractor handles absence gracefully either way.

---

## Follow-up work

### Use Monarch's transaction-ID matching instead of scraping notes

**This is the preferred long-term replacement for notes-hash correlation.**

Monarch's CSV importer supports [*"Use transaction IDs to match transactions"*](https://help.monarch.com/hc/en-us/articles/4409682789908-Importing-Transactions-Manually#h_01K6Y94BW0034W98J2328NXFSP),
and `id` **is** in the valid column list quoted above. That would let us send our
`{prefix}:{hash}` as a first-class transaction id rather than smuggling it through
the notes field, which would:

- remove the id from user-visible notes entirely (currently the main cosmetic
  cost of the feature);
- remove the notes-scraping regex from both reconciliation and owner sync;
- likely remove the need to retain the id at all, and with it the whole
  marker-tag retention invariant.

Deliberately deferred: it changes the correlation mechanism for pending
reconciliation too, so it wants its own design pass and careful migration for
transactions already carrying notes-embedded ids.

### Smaller items

- Verify `cardHolderName` presence on MBNA pending transactions.
- Consider extending `hasCardholders` to Wealthsimple credit cards if a
  cardholder name is ever exposed in their activity feed.
- Optional "re-own/re-tag last N days" action to backfill history, if requested.
