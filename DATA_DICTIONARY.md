# TIM Data Dictionary

> **This file is the single authoritative home for TIM's data shapes.** It moved here from
> Claude's project memory on 2026-10-20 so that it travels with the code and can be read by
> anyone building against TIM — see `BACKEND_SPEC.md` §6.3. The memory entry is now a
> pointer to this file; do not keep a second copy anywhere.

> **Maintenance rule:** Any time a data object gains, loses, or renames a field — in `invCreateEvent`, `rcConfirmCreate`, `rcMvCreateAndAttach`, `processRows`, `prodSaveEdit`, or `chkMergeAliasGroup` — update this file in the same commit. The goal is that a new chat never needs to read app.js to know the shape of an object.

---

## `appData` root

```js
appData = {
  product_map:        {},   // key → ProductMapEntry (see below); alias: PRODUCT_MAP
  history:            { records: [] },  // HistoryRecord[]
  inventory_sessions: [],   // InvSession[] — finalized AND (v2.57.00) active/checkpointed
  inventory_events:   [],   // InvEvent[] — likewise. Span these + live invEvents ONLY via
                            // invAllEvents(); a bare concat double-counts the open session.
  barcode_map:        {},   // barcode string → item number string; alias: BARCODE_MAP
  odoo_quants:        [],   // OdooQuant[] loaded from Odoo quants CSV
  recount_sessions:   [],   // RcSession[]
  recount_movements:  [],   // RcMovement[]
  external_count:     [],   // ExternalCountRow[] — recount worklist physical count (v2.30)
  product_movements:  [],   // ProductMovementRow[] — recount worklist Odoo moves (v2.30)
  nisc_capture:       [],   // NiscCaptureRow[] — recount worklist NISC expected/counted (v2.30)
  boxes:              {},    // normalized-uppercase boxId → BoxEntry (carton/container registry, v2.10.00)
  pallets:            {},     // normalized-uppercase palletId → PalletEntry (pallet→box registry, v2.38.00)
  reels:              {}      // normKey(reelNumber) → ReelEntry (cable-reel registry, v2.52.00)
}
```

`external_count` / `product_movements` / `nisc_capture` are **global, newest-wins** in `ghMergeMasters` (not row-merged — like `odoo_quants`), persisted per-file in IDB (`tim_recount_count_v1` / `_moves_v1` / `_nisc_v1` as `{rows, importedAt, fileName}`), and included in `buildExportPayload`/`loadSourceData`.

```js
```

`localStorage` holds only UI state (never synced): `tim_active_tab`, `tim_sidebar_collapsed`, `tim_username`, `tim_device_id` (stable per-device id, the write-lease key, v2.57.00), `tim_inv_subview`, `tim_voice_enabled`, `tim_efmt_*`, and `tim_testing_mode` ("1"/"0" — testing mode, v2.32.03; when "1", `ghPushToGitHub` suppresses ALL pushes so live-data testing can't leak upstream — see [[project-testing-mode]]).

---

## ProductMapEntry (`PRODUCT_MAP[itemNumber]`)

```js
{
  hctc:             string,   // HCTC/NISC item code (defaults to item number if blank)
  vendor:           string|null,
  external_id:      string|null,  // legacy alias for odoo_external_id
  odoo_external_id: string|null,  // Odoo product.product external ID (required for import)
  name:             string|null,  // Odoo product name; alias: description
  description:      string|null,  // same field, kept for older records
  tracking_type:    "serial"|"reel"|"none",
  serial_tracked:   boolean,
  requires_fsan:    boolean,
  history_only:     boolean,      // DNI — never import to Odoo
  updated_at:       string|undefined, // ISO timestamp, set on explicit user edits only
                                      // (prodSaveEdit, prodApplyUpload, saveBlindMapping) —
                                      // absent on inferred/legacy entries; added v2.03.00
                                      // for future newest-wins merging in GitHub sync
  aliases:          string[]|undefined // vendor part numbers folded in by the Catalog
                                       // Health merge (chkMergeAliasGroup, v2.04.00).
                                       // findProductMapMatch resolves these
                                       // (matchedBy:"alias"); shown as "aka" chips in the
                                       // catalog and included in product search.
}
```

Key = normalized (uppercase, trimmed) item number — but for ~30 Calix/Tarana
items the key is the **vendor/Calix part number** (e.g. `35-0171-001`), NOT the
NISC item number. The **NISC item number is the `hctc` field** (e.g. `6203`) and
the **NISC description is `name`** (`description` is a legacy duplicate). For most
items `hctc === key`. When showing a product to a human, lead with `hctc` + `name`,
not the key — the bare key is meaningless to warehouse users (drove a v2.09.00 fix
to the conflict-review header).  
`odoo_external_id` must be a `product_product` ID — `product_template` IDs are blocked.

---

## HistoryRecord (`appData.history.records[]`)

```js
{
  row_number:       number,
  source_type:      "calix"|"rma"|"blind"|"box_learned"|string,  // box_learned (v2.32.02): a serial↔FSAN
                                                                  // association captured manually in the box
                                                                  // capture modal's unknown-scan flow. Written
                                                                  // with status:"history_only" so it RESOLVES
                                                                  // globally but NEVER imports to Odoo. See
                                                                  // boxCapLearnAssociation.
  rma_number:       string,
  vendor:           string,
  sale_order:       string,
  customer_po:      string,
  ship_date:        string,      // ISO date string
  calix_product:    string,
  calix_description:string,
  hctc:             string,
  odoo_external_id: string,
  external_id:      string,      // legacy alias
  odoo_name:        string,
  serial_tracked:   boolean,
  requires_fsan:    boolean,
  history_only:     boolean,
  serial:           string,      // Calix serial / ref
  fsan:             string,      // Odoo lot/serial name (FSAN for ONTs)
  original_fsan:    string,
  mac_address:      string,
  mac:              string,      // alias for mac_address
  status:           "valid"|"blocked"|"dni"|"history_only"|"legacy_history"|string,
  imported_at:      string,      // ISO timestamp added on import
  messages:         string[]     // validation/warning messages
}
```

---

## InvSession (`invSession` global; also archived in `appData.inventory_sessions[]`)

```js
{
  sessionId:       string,   // invGenerateSessionId() → "inv_YYYY_MM_DD_nnnn"
  sessionName:     string,   // "username_customName_date_time" - a DISPLAY label.
                             // Never sort or group on it: it leads with the
                             // username, so it orders by person, then date.
  createdBy:       string,   // the username on its own (v2.54.04); absent on
                             // sessions created before v2.54.04
  createdAt:       string,   // ISO timestamp
  updatedAt:       string,
  status:          "active"|"closed",
  sequenceCounter: number,
  cycleId:         string|undefined,  // set when session is part of a recount chain

  // --- write lease (v2.57.00). Absent on sessions created before it. ---
  holderDevice:    string,   // timGetDeviceId() of the device allowed to checkpoint
                             // this session. Blank/absent = pre-v2.57.00, treated as
                             // held locally so an upgrade can't freeze a live count.
                             // Cleared by invFinalizeSession.
  holderLabel:     string,   // display only (timDeviceLabel()) — NOT unique, never a key
  heldAt:          string,   // ISO — when the lease was last claimed
  checkpointAt:    string,   // ISO — last checkpoint push

  // --- historical import (v2.60.00). Present ONLY on synthesised cycles
  //     loaded from pre-TIM spreadsheets by invHist*; absent on scanned ones.
  imported:        true,     // the flag every "is this real?" check reads
  cycleKey:        string,   // "2025.4" — the YEAR.QTR label, treated as FACT
  cycleEnd:        string,   // ISO end of that quarter. THE SORT KEY for Past
                             // Counts (_invPastSortStamp). A cycle is routinely
                             // counted after its quarter closes, so closedAt
                             // cannot order the record.
  countedByAll:    string[], // every distinct "COUNTED BY" spelling; createdBy
                             // is a capped display string built from it
  importedAt:      string,   // ISO — also the updatedAt, so a corrected
                             // re-import out-stamps other devices under LWW
  importedBy:      string,
  importedFrom:    string[], // source file names
  datesMissing:    boolean,  // no count dates in the sheet; closedAt fell back
                             // to cycleEnd and the UI says "not recorded"
  cycleAssumed:    boolean   // the label was derived from count dates (file had
                             // none) and confirmed by the user in the preview
}
```

**Ownership vs holding** — two independent gates. `createdBy` (username) is the OWNER: someone else's count is read-only, no override. `holderDevice` is the HOLDER: the owner on a second device sees "Continue here" and claims it. Same person + different device = handoff; different person = read-only. **The GitHub PAT is not an identity** — pasted per device, nothing calls `/user`, one shared token, so every device authenticates as the same GitHub user.

`appData.inventory_sessions` / `inventory_events` now contain ACTIVE sessions, not only finalized ones. Two consequences that bite:
- Anything spanning `appData.inventory_events` + the live `invEvents` must go through **`invAllEvents()`** (dedupes by `eventId`); a bare concat double-counts every open-session scan once a checkpoint has round-tripped.
- Anything that means "finalized" must now *check* `status === "closed"` rather than assume it (e.g. the product-detail count history does).

`inventory_sessions` merges **LWW per session** (`_ghMergeInvSessionsLWW`), not the generic 3-way array merge — with **CLOSED always beating ACTIVE** regardless of timestamp, so a late checkpoint can't resurrect a finalized session.

---

## InvEvent (`invEvents[]`; archived in `appData.inventory_events[]`)

Base fields on every event (set by `invCreateEvent`):

```js
{
  eventId:   string,   // "evt_timestamp_random"
  timestamp: string,   // ISO
  sequence:  number,   // restarts at 1 EVERY session - only orders within one
  eventType: string,   // see event types below
  countedBy: string,   // who scanned it; timGetUsername() at creation (v2.54.04).
                       // Absent on events written before v2.54.04 - resolve via
                       // invEventCountedBy(), never by parsing sessionName.
  status:    "active"|"voided",
  notes:     string,
  messages:  string[]
}
```

Additional fields vary by `eventType` (all merged from `data` arg):

| eventType | Extra fields |
|-----------|-------------|
| `serial` / `fsan` | `item_number`, `description`, `serial`, `fsan`, `mac_address`, `location` |
| `bulk` | `item_number`, `description`, `qty`, `location` |
| `cable_reel_count` | `scanType:"reel_number"`, `scannedValue`, `itemNumber`, `description`, `reelNumber`, `location`, `spanType:"single"\|"two_way"`, `innerSeqA`, `outerSeqA`, `availableFtA`, `innerSeqB`, `outerSeqB`, `availableFtB` (two-way only), `totalAvailableFt`, `qty` (= totalAvailableFt). `sequenceSwaps?: {span:"A"\|"B", user, at}[]` — audit trail of Inner/Outer swaps (v2.26.00); also summarized into `notes`. NOTE: actual field names are camelCase, not the snake_case shown in older versions of this table. |
| `box_scan` | `boxId`, `scannedValue`, `location`, `resolvedDeviceCount`, `expectedSerials` (audit snapshot), `sealedTrust:true` (counted without opening) |
| `serialized_device_scan` (from a box) | serial fields + `boxId`; `fromSealedBox:true` when emitted by a sealed fast-count (distinguishes trusted counts; voided on "Open box") |
| `serialized_device_scan` (loose, member of a box) | serial fields + `formerBoxId` — set (v2.36.00) when a normal individual scan counts a device that belongs to a registered box's manifest; the box is flagged `opened` (Phase 1 box lifecycle). Provenance: "was in box X, counted individually." Only present on loose scans, not box fast-counts. |
| `serialized_device_scan` (quant-resolved) | serial fields + `identitySource:"odoo_quant"` — set (v2.50.00) when the device wasn't in history but matched a **qty-1 unit-serial** in the Odoo quants baseline (`invResolveQuantSerial`); `item_number`/`description` come from the quant. Lets "on hand in Odoo but not yet in TIM history" devices auto-count instead of hitting the unknown-device prompt. Option A: only qty-1 unit-serials resolve this way — lot-tracked bulk/reels (qty > 1) still fall through to the prompt. |
| `exception` | `value`, `problem`, `action`, `scan_type` |
| `mac` | same as serial + `raw_mac` |
| *any, edited in TIM* (v2.61.00) | `manuallyEdited:true`, `editedBy`, `editedAt`, and **`importedValues`** = `{qty, location, notes, status}` — the row exactly as the file gave it, captured lazily on first edit. That snapshot is what lets a re-import tell "the file changed" from "the user changed it" (`invHistComputeDiffs`) and what Revert restores. `manualAdd:true` marks a row that exists in no file, so a re-import always keeps it. Removal sets `status:"voided"` + `voidedBy`/`voidedAt` — **never a hard delete**, since the rollups already exclude voided and a deleted row would just return on the next import. Only sessions flagged `imported` can gain any of these. |
| *any, historical import* (v2.60.00) | `imported:true`, `importSource` (file name), `sourceCycle` ("2025.4"), `sourceLine` (row in the sheet), `mappedKey?` (catalog key when the item resolved). `itemNumber` keeps the **spreadsheet's own** item number — the NISC number people search by — because the catalog key is a vendor part number for ~30 items; the catalog supplies `description`. `adjustedSerial` appears on a `bulk_quantity_count` carrying a serial whose qty is **not exactly 1** (negative = "could not find it", zero = "gone to RMA"): routing those through `serialized_device_scan` would flip their sign, since the rollup scores 1 unit per serialized event and ignores qty. |

**`bulk_quantity_count` units are `invEventUnits(evt)`, never `Number(evt.qty) || 1`** (v2.60.00). The old idiom could not tell "no qty recorded, assume 1" from "counted, found ZERO" — `0 || 1` is 1. Nothing *scanned* can produce a zero (the scan path hard-codes qty 1; the keypad clamps `qty < 1` to 1), but historical imports carry 322 deliberate zeros. The helper is used at all six rollup sites.

---

## RcSession (`rcSessions[]`)

```js
{
  recountId:   string,   // rcGenSessionId() → "rc_YYYYMMDDHHNN_xxx"
  recountName: string,
  cycleId:     string|null,    // links back to originating inv session
  parentId:    string|null,    // sessionId of parent inv session
  counters:    string[],       // usernames of counters
  createdAt:   string,
  status:      "active"|"closed",
  closedAt:    string|null,
  worklist:    boolean|undefined,   // true = created via Recount Worklist (v2.30); opens into worklist view
  autoAnomaly: boolean|undefined,   // v2.68.00 — TIM built this one itself to collect anomalies found during
                                    // the LIVE count (rcEnsureAnomalySession). One per parentId, named
                                    // "Anomalies — <session>". Currently only stale cartons land here; the
                                    // bucket is the intended home for other auto-detected anomalies too.
  wlAllItems:  boolean|undefined,   // true = built for all counted items (vs a pasted list)
  addedCountRows: [{ item, description, location, qty, day, dateRaw, line:"", isRecount:true, addedBy, addedAt }]|undefined,
                                    // v2.30.02 — "found-at" rows added during the walk. Count-row shape,
                                    // kept on the SESSION (not appData.external_count) so a count re-import
                                    // can't wipe them. Passed to rcBuildWorklist(focus, extraRows) → fold into
                                    // the item total (Short self-corrects) and render as ADDED shelf lines.
  items: {
    serialized: RcItem[],
    bulk:       RcItem[],
    reels:      RcItem[],
    containers: RcItem[]    // v2.68.00 — stale-carton audit rows (see the container variant below)
  }
}
```

---

## RcItem (inside `session.items.serialized[]` / `.bulk[]` / `.reels[]`)

Actual field names (camelCase) as of v2.30 — verified against `rcRenderDiscrepancySection` / `rcSetNiscQty` / `rcConfirmWorklistCreate`. (Older versions of this file listed snake_case names that never matched the code.)

```js
{
  rcItemId:        string,    // rcGenItemId() → "rci_..."
  itemNumber:      string,
  description:     string,
  location:        string,
  gapType:         string,    // "missing"|"unexpected"|"qty_mismatch"|"not_counted"|"not_in_quants"|"footage_diff"|"manual"
  niscExpectedQty: number|null,  // NISC expected (Captured) — inline-editable; seeded from NISC file in worklist
  status:          "pending"|"complete",
  resolutionStatus:string|null,  // confirmed_correct|adjusted_up|adjusted_down|product_movement|unable_to_locate
  movementIds:     string[],     // RcMovement IDs attached to this item
  // per-type discrepancy context + recount result:
  // serialized: serial, recountedSerials[]
  // bulk:       odooQty, countedQty, recountedQty        ← worklist recount writes recountedQty
  // reels:      reelNumber, odooFt, countedFt, innerSeqA, outerSeqA, recountedFt
}
```

---

## RcMovement (`rcMovements[]`)

```js
{
  movementId:          string,   // rcGenMovementId() → "mv_..."
  transactionNumber:   string,
  system:              "Odoo"|string,
  transactionType:     "receipt"|"transfer"|"adjustment"|"other"|string,
  qtyMoved:            number|null,
  customer:            string,
  responsible:         string,
  date:                string,
  correctlyAccounted:  "yes"|"no"|"unknown",
  notes:               string
}
```

Movements are global; they're attached to items via `item.movementIds[]`.

---

## BoxEntry (`appData.boxes[normalizedBoxId]`)

Carton/container → device registry (v2.10.00; **contents shape changed v2.32.00**). Lets one scan of a sealed box count every device inside. Built by scanning a Calix carton's manifest or the capture modal; overridden by re-scanning when opened. Map key = `normKey(boxId)` (uppercase, trimmed). Persisted under TimDB key `tim_boxes_v1` (`BOX_STORAGE_KEY`) + included in master-JSON export/import. **GitHub-synced since v2.34.00** as `boxes.json`, merged whole-box last-writer-wins by `updatedAt` (`_ghMergeBoxesLWW`, union of keys); every mutation debounce-pushes via `boxSaveToStorage`→`scheduleBoxPush`. **Soft-delete via tombstones since v2.35.00** (see `deleted*` fields below).

```js
{
  boxId:           string,    // original-case container ID as scanned (e.g. "63JGP3070178")
  expectedDevices: [          // v2.32.00: was a flat expectedSerials:string[] (auto-migrated on load
    {                         //   by boxMigrateDevices → [{serial}]; old field deleted). Fields MIRROR
      serial?: string,        //   history identifiers exactly: true Calix serial (printed on box label)
      fsan?:   string,        //   FSAN = the CXNK number (NISC's "serial number"; what a device reports)
      mac?:    string,        //   v2.32.01 renamed this field cxnk→fsan to match history.
      partial?: true,         //   a required capture column was left blank (flagged, not blocked)
      unverified?: true       //   v2.32.02 — a manually-placed UNKNOWN scan (didn't resolve against
    }                         //   history); surfaces the box's "needs review" set. Cleared if a later
                              //   resolved scan confirms the device. Identity = ANY id (normKey). Primary = serial→fsan→mac.
  ],
  expectedQty:     number|undefined,   // optional, user-typed or from carton "Qty" barcode
  calixProduct:    string|undefined,   // optional, e.g. "100-05804"
  location:        string|undefined,   // last known location
  status:          "capturing"|"ready", // capturing = open (re-scan resumes); ready = fast-countable
  opened:          boolean,   // true once it was reopened/overridden after a finalize (audit)
  source:          "scanned"|"import",
  createdAt:       string, createdBy: string,   // ISO + username
  updatedAt:       string, updatedBy: string,   // any touch (edit/capture/audit) bumps these
  deleted?:        true,      // v2.35.00 TOMBSTONE — soft-deleted. Excluded from boxGet/boxAll/
                              //   boxFindByIdentifier reads; kept so the deletion propagates via LWW.
                              //   Hard-purged locally after BOX_TOMBSTONE_TTL_DAYS (90) by
                              //   boxPurgeExpiredTombstones on load. Re-creating the ID or boxRestore
                              //   clears it (both stamp a newer updatedAt so revival wins LWW).
  deletedAt?:      string,    // ISO — when tombstoned (drives the 90-day purge + archive sort)
  deletedBy?:      string,    // username who deleted (admin gate: timIsAdmin, name contains "joe")
  audit:           [          // v2.33.00 — append-only floor-audit log; box list shows the
    {                         //   LATEST entry as "last audited". Written by boxRecordAudit.
      at:      string,        //   ISO timestamp
      by:      string,        //   username
      result:  "match"|"diff"|"updated"|"located",  // rescan==registry | differs (unchanged) |
                              //   contents replaced to match scan | found/located, not rescanned
      matched: number, missing: number, extra: number,  // diff snapshot at audit time
      location?: string       //   box's location as confirmed at audit time
    }
  ]|undefined                 //   absent until the box's first audit
}
```

Contents helpers: `boxDeviceList(b)` (migrates on read — **all contents reads go through it**, never `.expectedDevices` directly on a possibly-legacy box), `boxDevPrimary`/`boxDevKey`/`boxDevKeys`/`boxDevLabel`/`boxNormDev`/`boxMergeDev`. Data-layer fns (`box*`): `boxGet`, `boxAll`, `boxMigrateDevices`, `boxFindByIdentifier` (any-field move detection; `boxFindBySerial` alias), `boxUpsert`, `boxAddDevice` (dedup+move by shared id; `boxAddSerial` wrapper), `boxSetDevices` (override → `{missing,extra}` diff; `markOpened` arg; `boxSetSerials` wrapper), `boxFinalize`/`boxReopen`, `boxRecordAudit` (append an `audit[]` entry, v2.33.00), `boxSaveToStorage`/`boxLoadFromStorage`. **Delete lifecycle (v2.35.00):** `boxDelete` now **soft-deletes** (writes a tombstone); `boxRestore` (undelete), `boxPurge` (hard-remove), `boxPurgeExpiredTombstones` (load-time 90-day GC, silent write — no push), `boxGetRaw` (fetch incl. tombstones), `boxDeletedAll` (list tombstones). UI: `invBoxManagerDelete` admin-gated; `boxTabRestore`/`boxTabPurge`/`boxRenderDeletedInto` power the admin-only Deleted-boxes archive on the Boxes tab (`#boxTabDeleted`).

**Box audit (floor verification) — SHIPPED v2.33.00.** Deliberate scan-driven loop from the **Boxes tab** (NOT a sticky mode): scan a box ID → known box opens the **audit panel** (`boxAuditOpen`), unknown box → build it via the capture modal (`boxAuditBuildNew`). The panel shows the registry contents to eyeball vs the physical box, a **rescan** field (resolve any id via `boxResolveIdentifiers`; unresolved = pattern-classified extra), a **location** field, and a live **matched/missing/extra** diff (`boxAuditComputeDiff`, by shared identifier). Commit: **Record audit** (stamp only; result `match`/`diff`/`located`; updates `location` if changed) or **Update box to match scan** (`boxSetDevices` replaces contents; result `updated`). Both append to `audit[]` via `boxRecordAudit`; closing reverts focus to the tab scan field (loop). UI fns: `boxAuditScan`/`boxAuditBuildNew`/`boxAuditOpen`/`boxAuditClose`/`boxAuditScanDevice`/`boxAuditRemoveScan`/`boxAuditComputeDiff`/`boxAuditRender`/`boxAuditRecordOnly`/`boxAuditApplyUpdate`/`boxAuditCommit`/`boxAuditLastLabel`; global `boxAuditState`. (Boxes GitHub-sync since v2.34.00; testing mode still suppresses the push at `ghPushToGitHub`.)

**Duplicate feedback + single-box invariant (v2.33.01, no shape change).** Across the three box-building surfaces (capture modal, audit rescan, registry editor add), re-scanning an already-present device plays a distinct `duplicate` tone (added to `_timTonePatterns`) + highlights the existing row (transient `boxCapState.dupKey` / `boxAuditState.dupKey` / module `_boxEditorDup`; cleared on next scan/save/close — NOT persisted). Single-box invariant: a device lives in exactly one box; a scan matching a device in another box **prompts** to move it (`boxOtherBoxFor` → confirm) rather than auto-moving; approved moves strip it from the old box (`boxStripFromOthers`), deferred to Save in the capture modal (discard-safe). No `BoxEntry` field changed — all new state is transient/in-memory. Legacy in-session box mode intentionally excluded (retirement candidate).

**box_scan / serialized_device_scan events (v2.32.00):** `box_scan` now snapshots both `expectedSerials` (primary ids, back-compat) and `expectedDevices` (full records). Device-scan events emitted from a box carry `mac` alongside `serial`/`fsan`.

**Serial↔FSAN(CXNK) domain fact + naming convention (Joe, 2026-07-27):** Calix units have a true serial (printed on the box label) AND a CXNK number = the FSAN (what NISC records as the "serial number" and what a device reports when queried in the field). **CXNK and FSAN are the same number — use them interchangeably when discussing methods/design, but the app UI must ALWAYS say "FSAN," never "CXNK."** TIM's founding purpose: scan the label serials → derive the CXNKs/FSANs without opening the box. In the capture modal (`boxCapCellKey`) resolution is **symmetric** — scanning ANY identifier (serial/FSAN/MAC) resolves the unit via `boxResolveIdentifiers`→`invBoxResolveDevice` and fills the other ticked columns from history; unresolved → manual field-walk that teaches the DB the association.

**Phase 2 (v2.11.00):** 5th scan mode `invScanMode==="box"` (mode barcode `##MBOX`). In-session capture (scan carton → scan devices → Done) still exists and **counts**. Sealed fast-count: scan a `ready` box → `invHandleBoxScan` counts every `expectedDevices` entry (resolving each by any identifier) in one action. Open/override: **Open box** (`invBoxOpen`) → voids sealed-count events this session, clears+snapshots device records → re-scan → Done diffs missing/extra by primary id. Globals: `invActiveBox`, `invLastScannedBox`, `invBoxIsOverride`, `invBoxOverridePrior` (now device records).

**Capture modal (v2.32.00, Phase 1 of box redesign):** build/edit box contents as **registry work, session-independent, NO count events** (counting stays separate — scan the built box during a session). Globals `boxCapState`, `_boxCapLastCols`, `BOX_CAPTURE_COLUMNS`. Fns `boxCap*` (see [[project_box_counting]]). **Not yet built:** Verify/audit action (Phase 2), GitHub sync of `boxes` (Phase 3), pallets/grandparent (deferred), label printing.

---

## PalletEntry (`appData.pallets[normalizedPalletId]`)

Pallet/package → box registry (v2.38.00, box-counting "Pallets" Phase 1). One level up from `BoxEntry`: a shrink-wrapped, barcoded (or auto-ID'd) unit that HOLDS boxes. References member boxes **by key** (`boxKeys[]`, normalized box map-keys) — it never re-nests device serials; the box stays the single source of truth for its own contents. Map key = `normKey(palletId)`. Persisted under TimDB `tim_pallets_v1` (`PALLET_STORAGE_KEY`) + master-JSON export/import + GitHub-synced as `pallets.json`, merged whole-pallet last-writer-wins by `updatedAt` (`_ghMergePalletsLWW`; same two tradeoffs as boxes — deletions ride tombstones, concurrent audit edits can lose). Every mutation flows through `palletSaveToStorage`→`schedulePalletPush`. Soft-delete via tombstones (90-day GC, `PALLET_TOMBSTONE_TTL_DAYS`).

```js
{
  palletId:  string,     // original-case container ID as scanned, or PAL-YY-XXXX if generated (two-digit year; not PO-like)
  boxKeys:   string[],   // normalized map-keys of member boxes (references, not nested contents)
  location:  string|undefined,   // the pallet's own sticky location (NOT cascaded to boxes on a move)
  status:    "capturing"|"ready", // capturing = being built (re-scan resumes); ready = sealed/fast-countable
  source:    "scanned"|"generated",
  createdAt: string, createdBy: string,   // ISO + username (boxWho)
  updatedAt: string, updatedBy: string,   // any touch bumps these (drives LWW)
  deleted?:  true, deletedAt?: string, deletedBy?: string,   // TOMBSTONE (soft-delete; boxKeys retained)
  audit:     [{ at, by, result:"ready"|"moved"|"dissolved", boxCount?, location? }]|undefined  // append-only
}
```

**Two deliberate lifecycle rules (differ from boxes, Joe-confirmed):**
1. **Opening a sealed (`ready`) pallet invalidates it entirely** — no partial state. A box is freed from a ready pallet only by a deliberate **dissolve** (`palletDissolve`), which reverts every member box to an individually-tracked box and tombstones the pallet. (Adding a box that sits on another *ready* pallet is BLOCKED with "dissolve that pallet first"; a box on a still-*capturing* pallet just prompts to move.)
2. **Location is NOT cascaded on a sealed move** — `palletMoveLocation` sets only the pallet's own `location`; member boxes derive it while on the pallet. Box locations are assigned **at dissolve** via a same-for-all-or-scattered prompt (`plan.byBoxKey`), treated like a count (sticky until next changed; a blank assignment keeps the box's prior location).

**Per-box dissolve provenance (no BoxEntry schema addition needed beyond two fields):** on `palletDissolve`, each reverting box gets `formerPalletId: string` set + an `audit[]` entry `{ at, by, result:"pallet_dissolved", formerPalletId, location }`. So "was on pallet X, put at location L on <date>" reconstructs from the box, and the pallet tombstone retains its `boxKeys` as the pallet-side record. (This adds `formerPalletId` + the `pallet_dissolved` audit `result` to BoxEntry — the box-audit result enum now also includes `pallet_dissolved` alongside `match`/`diff`/`updated`/`located`.)

Data-layer fns (`pallet*`): `palletGet`/`palletGetRaw`/`palletAll`/`palletDeletedAll`, `palletBoxKeys`/`palletDeviceCount`, `palletGenId`, `palletUpsert`, `palletFindByBoxKey`/`palletStripBoxFrom`, `palletAddBox`/`palletRemoveBox`, `palletRecordAudit`, `palletFinalize`/`palletReopen`, `palletMoveLocation`, `palletDelete`/`palletRestore`/`palletPurge`/`palletPurgeExpiredTombstones`, `palletDissolve`, `palletSaveToStorage`/`palletLoadFromStorage`/`schedulePalletPush`. UI: Pallets tab (`switchTab('pallets')`, `palletRender`), build modal (`palletCap*`, incl. nested unknown-box build `palletCapBuildMissingBox`/`palletCapResumeAfterBox` — hooked into `boxCapClose` via `_palletCapResume`), dissolve modal (`palletBeginDissolve`/`palletDissolveConfirm`). **Deferred to Phase 2:** scan-driven contents verify, in-session fast-count (transitive sealed trust). See [[project-box-counting]] "Pallets".

---

## OdooQuant (`invQuantsBaseline[]`)

Structured rows built by `invProcessOdooQuantCsv` from the Odoo stock quant CSV/XLSX export (accepts both technical headers and default display-name headers, v2.49.05). One row per product-location-lot:

```js
{
  quantId:         string,   // Odoo quant record id ("id"/"External ID"); OPTIONAL (v2.49.05) — only
                             //   needed to target existing quants when pushing adjustments back to Odoo
  itemNumber:      string,   // parsed from "[item] description" Product column
  description:     string,
  locationId:      string,   // location PATH as Odoo exports it (e.g. "W367/S/3700") — NOT a TIM WHxxxxx
                             //   barcode; the two don't map by formula (see [[project-location-crosswalk]])
  locationBarcode: string,   // resolved TIM barcode via invLocationPathToBarcode (may be blank)
  lotId:           string,   // Lot/Serial Number — the device's FSAN/serial for unit-serials; blank for
                             //   untracked bulk. NOTE: also non-blank on LOT-tracked bulk/reels (qty > 1)
  odooQty:         number,   // "Quantity" = on-hand. odooQty === 1 ⇒ a true unit-serial (the test the
                             //   quants fallback + coverage use to include a row, v2.50.00)
  inventoryQty:    number,   // "inventory_quantity" (counted) if present
  accountingDate:  string,
  importedAt:      string    // ISO
}
```

**Serialized fallback + coverage (v2.50.00):** `invBuildQuantSerialIndex` caches a `normKey(lotId) → row` map of **qty-1 rows only** (rebuilt when `invQuantsBaseline` is reassigned); `invResolveQuantSerial(vKey)` powers the history→quants→prompt fallback in `invHandleSerializedScan`. `invQuantSerialCoverage()` → `{total, known, unknown}` (on-hand unit-serials vs. history) drives the one-line readiness summary on quants load. See [[project-quants-serial-fallback]].

---

## ReelEntry (`appData.reels[normKey(reelNumber)]`, v2.52.00)

Durable cable-reel registry — the merged home for reels, keyed by normalized reel
number (= Odoo lot = Product Reels "Reels No"). **Three writers**:
- `reelSyncFromQuants()` owns **live** fields (`onHandFt`/`locationId`/`presence`/`quantsAt`) from `invQuantsBaseline`. Won't archive a reel counted after the baseline (`lastCountedAt > stamp` keeps it live).
- `reelUpsertReference()` owns **reference** fields (`innerSeq`/`outerSeq`/`notes`/`refCountDate`) from the Odoo "Product Reels" standalone view (a manual view that does NOT track stock moves).
- `reelUpsertFromCount()` (Phase 3, v2.52.01) — a live `cable_reel_count` scan: writes `lastCountedFt`/`lastCountedAt`, resurrects (`presence:"live"`), and makes the floor reading the reference (span-A seq → `innerSeq`/`outerSeq`, `refCountDate` = count time). Hooked in `invSubmitReelEntry` after `invCreateEvent`.
- `reelApplyManualEdit()` (Reel Lookup → Edit, v2.52.02) — human correction: owns sequences (+notes) as the newest reference (`refCountDate = now`), optional recency-guarded presence override; does NOT set footage (so a hand-entered sequence that disagrees with on-hand correctly flags Stale). UI: `reelOpenEditModal`/`reelSaveEdit`/`reelCancelEdit`/`reelEditSpanChanged`/`reelEditRecalcPreview` + `#reelEditModal`, Edit button per Reel Lookup row.

```js
{
  reelNumber:   string,   // identity; = Odoo lot / Product Reels "Reels No"
  itemNumber:   string,   // SKU
  description:  string,
  // ── QUANTS-owned (live) ──
  onHandFt:     number|null,   // current footage from quants (null until a sync sees it)
  locationId:   string,        // quant location PATH (e.g. "W367/S/Reels")
  presence:     "live"|"gone"|"unconfirmed",
                               //   live = in current baseline; gone = was in quants, now absent
                               //   (ARCHIVED, retrievable, resurrects to live on reappearance);
                               //   unconfirmed = reference-only, quants has never seen it
  quantsAt:     string,        // ISO of the baseline that set onHandFt ("" until first sync)
  // ── PRODUCT REELS-owned (reference) ──
  innerSeq:     number|null,   // footage marker at inner end (null = no marker, e.g. duct/plow)
  outerSeq:     number|null,
  innerSeqB:    number|null,   // two-way span B (from a two-way count or manual edit; else null)
  outerSeqB:    number|null,
  notes:        string,
  refCountDate: string,        // ISO/raw of "Last Updated on" (a live count OR a manual edit sets this = now)
  // ── COUNT-owned (live cable_reel_count scan, Phase 3 v2.52.01; reelUpsertFromCount) ──
  lastCountedFt: number|null,  // footage from the most recent floor count (count-owned truth)
  lastCountedAt: string,       // ISO of that count — beats quantsAt ⇒ effective footage = lastCountedFt
  lastCountedBy: string,       // username (a count also writes its span-A seq into innerSeq/outerSeq
                               //   + presence:"live" (resurrects), and refCountDate = this timestamp)
  // ── derived (reelRecomputeDerived) ──
  refFt:        number|null,   // |outerSeq − innerSeq| the markers imply (null if either blank)
  sequenceStale:boolean,       // live && |effFt−refFt|>REEL_STALE_TOL_FT(2), where effFt = lastCountedFt
                               //   if a count is newer than quantsAt, else onHandFt. SKIPPED when footage
                               //   AND sequences came from the same count (also covers two-way sums).
                               //   ⇒ markers stale, re-verify physically. NEVER auto-corrected
                               //   (no reliable consumption convention; inner ≷ outer both occur).
  needsSequences:boolean,      // live && no inner/outer captured yet → capture at next scan
  source:       "quants+reels"|"quants-only"|"reels-only"|"count",  // provenance (derived)
  spanType:     "single"|"two_way",   // two-way adds innerSeqB/outerSeqB; refFt = |A| + |B|
  // ── manual-edit (Reel Lookup → Edit; reelApplyManualEdit, v2.52.02) ──
  presenceOverride:   "live"|"gone"|null,  // manual status; RECENCY-GUARDED in reelSyncFromQuants —
  presenceOverrideAt: string,              //   held only while overrideAt > baseline stamp, then cleared
  editedAt, editedBy,                      // last manual edit (ISO + username)
  createdAt, createdBy, updatedAt, updatedBy,  // ISO + username (reelWho). A reel CREATED by
                               //   reelSyncFromQuants gets createdAt but updatedAt:"" (v2.55.00) —
                               //   a quants sync is not an edit and must not outrank one on merge.
  // ── sequence undo (v2.55.00; _reelSnapshotSeq) ──
  seqPrev:      { innerSeq, outerSeq, innerSeqB, outerSeqB, spanType, refCountDate,
                  at, by } | undefined
                               // last known-good marker set, written before ANY overwrite or clear.
                               // Surfaced in the edit modal as "Previous reading … [Restore]".
}
```

**THE STICKY-SEQUENCE RULE (v2.55.00, standing):** a blank never overwrites a known
`innerSeq`/`outerSeq`, from any automated writer. Stale sequences are wanted — a counter with a
stale marker verifies a number, a counter with a blank derives it, and reel counting without
markers is badly slow. All writes funnel through **`reelSetSequences`** (the only place those four
fields are assigned); `opts.allowClear` is the single destructive path and belongs to the human
edit modal alone (checkbox + confirm-by-reel-number). `_reelCarrySequences` applies the same rule
to the GitHub merge. See [[project_reel_registry]].

Persisted under `tim_reels_v1` + carried in `buildExportPayload`/`loadSourceData`/master-cache restore — all of which **MERGE the registry per-record, never assign it wholesale** (v2.55.00; the wholesale assign in `loadSourceData` is how a master JSON export silently reverted every edit made since it was taken — boxes/pallets had the identical hole). **GitHub-synced as `reels.json`, whole-reel LWW by `updatedAt` (`_ghMergeReelsLWW`, v2.52.00 Phase 2)**, now with `_reelCarrySequences` so the timestamp decides the record but can never cost a sequence. The older claim that "only a REFERENCE write bumps `updatedAt`, so a footage-only device can't clobber sequences" was **false and caused real data loss on 2026-09-22**: `reelSyncFromQuants` stamped `updatedAt` on freshly-created blank reels, so a device that had only loaded quants published empty records dated today that beat another device's hand-entered markers. The quants reconcile still persists LOCAL only (`_reelPersistLocal`, no push), since footage re-derives from the synced `quants.json`. Reel Lookup (`reelLookupBuildList`) is **registry-primary**: a `cable_reel_count` event overrides footage/sequences only when the count is **NEWER than the quants baseline** (recency-aware — a stale historical count must NOT shadow current quants or hide staleness; this fixed a bug where 513 old June counts hid 26 of 36 stale reels). **The events-based reel-CSV import path was retired v2.52.00** — a Product Reels import now feeds registry reference, not `cable_reel_count` events. **Gate:** a quant lot auto-creates a reel only if its item is `tracking_type:"reel"` in PRODUCT_MAP OR the reel already exists in the registry. **Dirty-lot detector** (`reelDirtyQuantLots`): reports quant lots with notes typed into the lot field (`288R02 (2 REELS)`) — never strips (fix in Odoo). See [[project_reel_registry]].

---

## Recount Worklist source rows (v2.30)

Normalized at import (numbers comma-stripped via `rcNum`, dates→YYYYMMDD int). Parsers fail loud on missing required headers (Joe fixes the source — see [[feedback_fix_source_not_code]]).

```js
// ExternalCountRow (appData.external_count) — from the physical count CSV
{
  item:string, description:string,
  location:string,        // the "Ticket" column = physical shelf (WHxxxxx); the walk target
  qty:number,             // QuantitySum
  day:number|null,        // COUNT DATE as YYYYMMDD (per-item, per-line)
  dateRaw:string, line:string,
  isRecount:boolean       // blank LINE# = recount appended after the original count
}

// ProductMovementRow (appData.product_movements) — from the Odoo moves CSV
{
  item:string,            // parsed from "[item] desc" Product column
  date:string, day:number|null,   // YYYY-MM-DD → YYYYMMDD
  reference:string,
  qty:number,             // Odoo stores all qty positive
  io:"IN"|"OUT"|"UNK",    // direction from Reference prefix (rcMovementDir): WHCHG=OUT; WH/RETURN,WHRMA-IN,WHRX,blank=IN
  label:string
}

// NiscCaptureRow (appData.nisc_capture) — from NISC export; ONE importer handles bulk/reels/serials (upserted by item)
{
  item:string,
  captured:number,        // "Captured Qty" = NISC expected/target (the Short-vs-NISC number)
  niscCount:number,       // "Current Count Qty" = what NISC posted (baseline; captured>niscCount ⇒ possible dropped row)
  description:string, aisleBin:string,
  classification:"bulk"|"serialized"|"reels"  // from the Serial/Reel column (blank/S/R)
}
```

The join engine `rcBuildWorklist(focusSet)` returns `{ flat[], absent[], niscDrops[] }`: `flat` = per-shelf rows (outbound auto-subtracted → `expected`, inbound `inAfter` flagged not added, `shortVsNisc = captured − total`); `absent` = focus items with zero count rows; `niscDrops` = captured > niscCount candidates.

---

## RcItem — container variant (inside `session.items.containers[]`)

A stale-carton audit row (v2.68.00). Deliberately NOT shaped like the item variants: a carton audit has no `itemNumber`, no expected-vs-counted quantity, and its resolution is "open it and scan what's actually inside", not "type a figure". Created by `rcAddStaleBox` when `invBoxHandleStale` voids a carton's sealed count; completed by `rcCompleteStaleBox`, which fires from `boxRecordAudit` (both the Boxes-tab audit modal and the in-count `invBoxFinish` override path).

```js
{
  rcItemId:        string,      // rcGenItemId()
  containerType:   "box",       // room for "pallet" later
  boxId:           string,
  itemNumber:      "",          // always empty — kept so generic item code can read the field
  description:     string,      // "Carton BOX-A — 2 device(s) on the manifest"
  location:        string,      // where the contradiction was found (invCurrentLocation at flag time)
  gapType:         "stale_box",
  staleReason:     string,      // why it was flagged, in the operator's terms
  deviceCount:     number,      // manifest size at flag time — what is currently UNCOUNTED
  expectedDevices: string[],    // primary ids snapshotted at flag time (boxDevPrimary)
  status:          "pending"|"complete",
  resolutionStatus: null,       // deliberately never set — the item resolution enum describes
                                // quantity outcomes and would misrepresent a carton audit
  movementIds:     [],
  // set on completion:
  auditResult:     "match"|"diff"|"updated"|"located"|undefined,
  auditCounts:     { matched, missing, extra }|null,
  auditedAt:       string|undefined
}
```

**Read `rcAllItems(session)`, never the three original buckets** — it concatenates all four. Four sites previously enumerated `serialized`/`bulk`/`reels` by hand for totals and pending counts; they now go through the helper so a new bucket can't be missed at one of them and skew a progress figure.
