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

These two facts are non-obvious and load-bearing for the whole design:

1. **The `Owner` CSV column is matched against household member `users[].name`** —
   not `displayName`, not the user `id`, not an email. We must emit the exact
   `name` string returned by `Common_GetHouseholdMembers`.
2. **A non-matching `Owner` value silently reverts to the household default.**
   Monarch does not reject the import. This makes the feature fail-safe: a bad or
   stale value degrades to today's behaviour rather than breaking a sync.

Consequence: `displayName` is only ever a *matching hint* and a UI label. The
value written to CSV always comes from the live household list.

---

## Two independent features

| Feature | Setting | Default | Values |
|---------|---------|---------|--------|
| Owner mapping | `cardholderOwnerMode` | `off` | `off` \| `on` |
| Cardholder tag | `cardholderTagMode` | `off` | `off` \| `auto` \| `always` |

Both default to **off**, so no existing user sees any change until they opt in.
The two are independent — Owner alone, tag alone, both, or neither are all valid.

- **Owner `on`** — emits the resolved household member name, or
  `CARDHOLDER.SHARED_OWNER` (`"Shared"`) when the cardholder has no mapping.
- **Tag `auto`** — tags only once **two or more** cardholders have ever been
  discovered for the account (see below). **`always`** — always tags.

When owner mapping is `off`, the `Owner` column is emitted empty, which is
identical to the pre-feature behaviour for every integration.

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
      monarchUserId: '162625044845828370', // stable key; null when Shared/unresolved
      monarchUserName: 'Mykhailo Delegan', // cached users[].name → the Owner value
      isShared: false,                     // true = user explicitly chose Shared
      matchType: 'manual'
    }
  }
}
```

Two fields deserve explanation:

- **`isShared`** distinguishes "the user deliberately chose Shared" (do not
  prompt again) from "never asked" (do prompt). Both emit `Shared`, but only one
  suppresses the prompt.
- **`monarchUserName` is a cache, `monarchUserId` is the key.** If a household
  member renames themselves in Monarch, a stale cached name would stop matching
  and Monarch would silently revert the Owner value. So every sync refreshes
  `monarchUserName` from the live household list, keyed on the ID. If the mapped
  member has left the household entirely, the entry reverts to unresolved.

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
| Mapping prompt | `src/ui/components/cardholderSelector.ts` |
| Settings widget | `src/ui/components/settingsModalCardholders.ts` |

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
resolving or refreshing. **A fetch failure is non-fatal**: it is logged, Owner
degrades to `Shared`, and the sync continues.

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
- **Reconciliation needs no changes.** `computeSettledTagIds` already preserves
  non-`Pending` tags, so a cardholder tag survives the pending → settled
  transition. Existing update calls already pass `ownerUserId`.
- **`Owner` is always either a live household member `name` or `Shared`/empty.**
  Never emit a cached name without refreshing it against the household list.

---

## Rejected alternatives

**MBNA's `/waw/mbna/{account}/cardholders` endpoint.** MBNA can enumerate every
authorized cardholder on an account. We deliberately do not call it: an
authorized user who never transacts would still be listed, which would flip
`auto` tagging on for an account that is single-user in practice. Deriving
cardholders from transactions gives the intended behaviour and avoids an extra
HTTP call plus a second code path. Rogers has no equivalent endpoint, so
transaction-derived discovery is also the only uniform approach.

**Post-upload GraphQL owner assignment.** `updateTransaction(id, { ownerUserId })`
exists and would let us set the owner without the CSV column, using a transient
tag as a correlation key. It is strictly more expensive (one request per
transaction) and only worth revisiting if the CSV column proves insufficient.

**Tag-only (no Owner).** The original issue asked for a tag, but Monarch's native
Owner field is semantically correct and filterable/reportable in ways a tag is
not. Both are supported so users who prefer tags — or who have authorized users
outside their Monarch household — are still served.

---

## Known limitations

- **Owner requires a matching Monarch household member.** Authorized cardholders
  who are not household members can never be mapped; they emit `Shared`. This is
  surfaced in the settings widget rather than hidden.
- **No historical backfill.** Transactions uploaded before the feature was
  enabled (or before a second cardholder appeared) keep their original empty
  Owner and no tag.
- **MBNA pending transactions are unverified.** `cardHolderName` is confirmed on
  settled MBNA rows; if it is absent on pending rows, those upload with `Shared`
  and keep it through settlement (reconciliation preserves tags but does not add
  them). The extractor handles absence gracefully either way.

---

## Follow-up work

- Verify `cardHolderName` presence on MBNA pending transactions.
- Consider extending `hasCardholders` to Wealthsimple credit cards if a
  cardholder name is ever exposed in their activity feed.
- Optional "re-tag last N days" action to backfill history, if requested.