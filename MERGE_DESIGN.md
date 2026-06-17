# TIM Union Auto-Merge — Design Spec

Status: **approved, building Phase 1** (2026-06-16). Decisions locked here so phases don't relitigate.

## Problem

TIM syncs a shared master data set to a private GitHub repo (`data/` folder). Multiple
warehouse devices read and write it. Today:

- A **push conflict** (repo changed since this device last pulled) is *blocked* in auto mode
  (v2.05.00) — safe, but the two sets of changes don't get combined.
- A **pull** (`ghSyncNow`) *overwrites* local data — so a device with unpushed local changes
  loses them if it Syncs.

Both people's changes need to survive. This spec defines a key-addressable **3-way merge**
that powers both directions, plus a **shared conflict log** so true collisions are surfaced
to every device and resolved on demand without blocking anyone.

## Why 3-way (not a 2-way union)

A plain `local ∪ remote` silently *resurrects* anything one device deleted — a real problem
for `product_map` (Catalog Health and `prodDelete` remove entries). We already cache the
last-pulled blob SHA per file (`GH_SHAS_KEY`); GitHub serves that exact blob by SHA
(`GET /git/blobs/{sha}`) even after the ref moves. So we can fetch the **base** the two sides
diverged from and distinguish *added* from *deleted*. One uniform algorithm for every file.

## Collections & keys

| Collection | Container | Key | Field-merge? |
|---|---|---|---|
| `product_map` | object | item number (normalized) | yes (`PRODUCT_MERGE_FIELDS`) |
| `barcode_map` | object | barcode | no (scalar value) |
| `history.records` | array | `normKey(serial \|\| ref)` | yes (`MERGE_FIELDS`) |
| `inventory_sessions` | array | `sessionId` | no |
| `inventory_events` | array | `eventId` | no |
| `recount_sessions` | array | `recountId` | no |
| `recount_movements` | array | `movementId` | no |
| `odoo_quants` | array | — | **not merged** — full Odoo snapshot; newest push wins |

`odoo_quants` is reference data replaced wholesale by whoever loads a fresh Odoo export; merging
it row-by-row is meaningless, so it is excluded (last-writer-wins, documented).

## 3-way algorithm (per key)

`b` = base value, `l` = local, `r` = remote. `inX` = key present in X. Equality is deep
(order-insensitive via stable stringify).

- `inL && inR`:
  - `equal(l,r)` → take `l`. (no conflict)
  - else if `!inBase` → both **added** the same key differently → field-merge (records) or scalar conflict.
  - else: `lChanged=!equal(l,b)`, `rChanged=!equal(r,b)`.
    - only `lChanged` → take `l`; only `rChanged` → take `r`.
    - both changed → field-merge (records) or scalar conflict.
- `inL && !inR`:
  - `!inBase` → local **added** → take `l`.
  - `inBase && !lChanged` → remote **deleted**, local untouched → honor delete (drop key).
  - `inBase && lChanged` → local edited vs remote deleted → **keep local, flag conflict** (edit-vs-delete).
- `!inL && inR`: symmetric to above.
- `!inL && !inR`: drop.

### Field-merge (records: `product_map` entries, `history` records)

Start the merged record from the **newer** of `l`/`r` (by `updated_at`/`imported_at`/`timestamp`)
so operational metadata not in the curated field list follows the newer record. Then for each
field in the collection's field list:

- `lChanged && rChanged && lv!==rv` → **true field conflict**: provisional = newer side's value;
  emit a conflict entry with both candidates.
- only `lChanged` → take local; only `rChanged` → take remote; neither → keep base.

Disjoint field edits therefore auto-merge; only the *same field set to two different non-empty
values* is a true conflict. (Reuses the philosophy of the existing `previewMerge`/`mergeMissingFields`.)

### Scalar conflict (`barcode_map`, edit-vs-delete)

No fields to merge: provisional = newer side (or local for edit-vs-delete); emit a conflict entry.

## Storage

The conflict log is a normal managed file in the repo's `data/` folder — `data/conflicts.json` —
built by `ghBuildDataFiles`, pushed in the **same atomic commit** as the data, and pulled back by
`_ghAssembleRemote` on every sync. This is the shared source of truth all devices read/write. Each
device also keeps a local mirror in IndexedDB (`GH_CONFLICTS_KEY`) so the badge/list survive reloads
and work offline; every sync reconciles the mirror against the repo copy (deduped by `conflictId`,
resolved-wins).

## Conflict entry shape (`data/conflicts.json`)

```js
{
  conflictId:  string,   // stable: `${collection}::${key}::${field}`  (field "" for scalar/whole-record)
  collection:  string,   // "product_map" | "history" | "barcode_map" | ...
  key:         string,   // entity key (item number, serial, barcode, …)
  field:       string,   // conflicting field, or "" for scalar/edit-vs-delete
  type:        "field" | "scalar" | "edit_vs_delete",
  baseValue:   string|null,
  candidates: [           // every distinct side, newest first
    { value: any, device: string, user: string, ts: string }
  ],
  provisional: any,       // value currently written into the master (newest-wins guess)
  status:      "unresolved" | "resolved",
  detectedAt:  string,
  resolvedAt:  string|null,
  resolvedBy:  { device, user } | null,
  chosenValue: any        // set on resolution; overwrites provisional in the master
}
```

`conflictId` is stable so the same collision detected by multiple devices dedupes to one entry
(candidates may accrue). Resolved entries are retained (status flip) for audit, pruned later.

## Resolution flow (the hybrid)

1. Detect during merge → **never block**. Provisional value written; entry logged.
2. Merged master + `conflicts.json` pushed in one atomic commit.
3. Every device pulls `conflicts.json` on sync; if any `unresolved`, show a banner + count.
4. User opens **Conflicts review** on demand, picks the winner per conflict → writes
   `chosenValue` into the master record, flips entry to `resolved`, pushes.
5. Other devices pick up the resolution on next sync.
6. Optional convenience: right after a push that logged new conflicts, offer a non-blocking
   "review now?" prompt — opens the same screen. Not required; not coercive.

## Safety

- Merge is a **pure, in-memory function** — no I/O, deterministic, unit-testable.
- Fixture-tested (against `source_data*` fixtures + synthetic 3-way cases) **before** any live
  sync path calls it.
- Push stays atomic (blobs → tree → commit → ref); a drop mid-push leaves the repo untouched.
- No value is ever silently discarded: a losing candidate always lives in the conflict log
  until a human resolves it.

## Build phases

- **Phase 1 (this step):** pure 3-way merge engine + fixture tests. No repo/UI changes.
  - `ghMergeMasters(base, local, remote, ctx)` → `{ merged, conflicts }`
  - `_gh3MergeCollection(...)`, stable-equal + newer-record helpers, collection config.
- **Phase 2a (done, v2.06.00):** pull merges instead of clobbering; `conflicts.json` plumbed into
  build/pull; merge **base** persisted locally (`GH_BASE_KEY`) on pull + push success.
  Note: base is the last-synced payload, not fetched-by-SHA — simpler and GC-proof.
- **Phase 2b (done, v2.07.00):** push rebases on conflict — fetches remote content,
  `ghMergeMasters`, then `_ghWriteCommit`s the merged union (auto + manual). Never blocks,
  never overwrites; true collisions logged to `conflicts.json` and pushed. A second
  concurrent race (head moves during the rebase write) fails cleanly with a 422 → "Sync then
  push" (not auto-retried — rare).
- **Phase 3 (done, v2.08.00):** sidebar **Conflicts** badge (hidden until unresolved > 0) → review
  modal listing each conflict's candidates with provenance; **Keep this** writes the chosen value
  back into the master and marks the entry resolved. Auto-push fires only when the last conflict is
  resolved; **Push resolved now** publishes the resolved subset while others remain (per Joe — don't
  hold resolved fixes hostage to ones needing field re-verification).
- **Phase 3.1 (done, v2.09.00):** review screen made non-technical and choices editable until pushed.
  - Each conflict shows a friendly header (e.g. *Catalog item: 35-0171-0010 — <NISC description>*),
    a plain-English field label (`serial_tracked` → "Serial-number tracking"), plain-English values
    (`true`/`false` → "Tracked by serial number" / "Not tracked by serial number"), and provenance
    in user terms ("Joe" / "the shared database"). The raw `collection · key · field` line is kept
    small for traceability. Helpers: `_ghConflictContext`, `_ghFieldLabel`, `_ghFmtFieldValue`,
    `_ghCandidateWho`.
  - **Resolve is decoupled from publish.** `ghChooseCandidate` applies the choice to the master and
    saves locally but no longer pushes; an entry stays editable (re-pick any candidate) until it is
    **published**. The former auto-push-on-last-resolved was **removed** (superseded by Joe's request
    for a review window). An explicit **Publish choices** button (`ghPushResolved`) pushes; on any
    successful push `_ghMarkResolvedPublished` sets `published:true` on resolved entries, which locks
    them. New entry field: `published` (boolean). New counts: `ghUnpublishedResolvedCount`,
    `ghPendingConflictCount` (badge now = unresolved + resolved-but-unpublished, so the entry stays
    visible until choices are published).

## Status: feature complete (v2.09.00)

All three phases shipped. Remaining non-goals stand: no automatic resolution of true conflicts,
`odoo_quants` not merged, conflict-log pruning deferred.

## Open items / non-goals (v1)

- No automatic resolution of true conflicts — a human always picks (by design).
- `odoo_quants` not merged (newest push wins).
- Conflict-log pruning policy (when to drop resolved entries) deferred to a later pass.
