# TIM — Feature Backlog

Ideas and planned work not yet scheduled. Add context for *why* — the motivation is
usually more valuable than the feature description by the time work starts.

## Under investigation

### Live Odoo connection (pull/push)
**Want:** TIM talks to Odoo directly — pull product catalog / quants / locations live,
and push receiving batches and inventory adjustments back — instead of shuttling CSV/XLSX
exports and imports by hand.

**Why (pain):** File imports into Odoo are unreliable and still failing despite repeated
attempts — **inventory count imports especially**. Every failed import costs a round of
export → massage → re-import. A live connection removes the file layer entirely.

**Investigation notes (as of June 2026):**
- Odoo's External API is XML-RPC / JSON-RPC (`/xmlrpc/2/`, or JSON-RPC `/web/dataset/call_kw`).
  Models of interest: `product.product`, `stock.quant`, `stock.location`, `stock.lot`,
  `stock.picking` / `stock.move.line` (receiving), inventory adjustments via
  `stock.quant.action_apply_inventory`.
- **Browser-direct will likely hit CORS** — Odoo doesn't send CORS headers by default.
  Options to evaluate: (a) Odoo reverse-proxy config adding CORS headers, (b) a tiny
  middleware/proxy (contradicts no-backend ethos, but may be unavoidable), (c) an Odoo
  module exposing a CORS-enabled REST endpoint.
- Auth: Odoo API keys (per user, Settings → Account Security) work with XML-RPC as the
  password — same storage model as the GitHub PAT in TIM.
- First diagnostic step before building anything: capture the exact failure mode of the
  current inventory-count imports (error messages, which rows fail, Odoo version) —
  it's possible the file format is fixable cheaply while the live connection is built.

## Strategic direction — TIM as baseline spec for Odoo-native features

Rather than (or alongside) TIM talking to Odoo, the longer-term plan under discussion is
having **Nihala (Odoo developer) build TIM's workflows into Odoo itself**, using TIM as
the working reference implementation / requirements baseline. Adjust Odoo's inventory
process to match the warehouse workflow TIM already encodes.

Known feature targets (much-needed; a previous developer started but never finished):
- **Scan a serial number → return the FSAN** (TIM: `invResolveBySerial` / history lookup)
- **Scan a multi-barcode → return the NISC item** (TIM: `BARCODE_MAP` semantics, `bc*` subsystem)
- Candidates beyond that: scan-type auto-classification (`invClassifyScan`), exception
  handling during counts, recount chains with audit trail.

**Status (June 2026): deferred, deliberately.** Odoo dev bandwidth is committed to
higher-priority work. Plan: keep improving TIM as the operational tool, then port into
Odoo **piece-by-piece** when bandwidth frees — each piece retired from TIM only after its
Odoo equivalent proves out in the warehouse. When a piece is picked up, first step is
extracting its spec from TIM (see below).

Implications to keep in mind:
- TIM stays the operational tool until Odoo-native features ship **and prove out in the
  warehouse** — don't halt TIM work on the promise of a port.
- Hand Nihala tight, precise specs extracted from TIM (scan classification rules, data
  shapes, lookup semantics), not feature names — the previous attempt likely failed on
  underspecification. TOC.md + the data dictionary are the raw material.
- Per feature, decide deliberately: build into Odoo vs keep in TIM (lookups/scanning are
  strong Odoo candidates; recount audit-trail/XLSX storytelling may be fine staying in TIM).

## Planned

### Bulk count import from NISC — mirror the reel CSV importer
**Want:** Import NISC's bulk "Ticket Count" results into TIM (400+ rows this cycle) the
same way the reel CSV importer already works — drop a file, match by item+location,
supersede what TIM currently has. Manual one-at-a-time entry via the Bulk/Item # prompt
doesn't scale to this volume.

**Why:** Bulk counting already works well inside NISC — two clicks and NISC's own count is
updated, no reason to duplicate that by re-scanning bulk items in TIM. But the end goal is
for TIM to be the single place that exports one unified count (bulk + reel + serialized)
into Odoo (see "Live Odoo connection" above) — that only works if TIM actually holds an
accurate bulk count, which today it doesn't unless someone re-enters ~400 rows by hand.

**Why NISC and TIM stay split at all:** NISC hard-blocks anything that doesn't match its
expected data shape — no partial workaround, no "record with a note to fix later," it's a
locked gate. Reels are too click-heavy in NISC's Ticket Count screen, so they're counted
outside NISC and imported into TIM via the reel CSV importer. Bulk is the inverse — NISC
handles it fine, so bulk counting stays there; the gap is just getting that finished NISC
count mirrored into TIM afterward.

**Confirmed export format (sample: `MR GM COUNT 070126 v2.csv`, ~400 rows):**
Columns: `Line, Item, Description, Quantity, Location, Sub Location, Sub Location Desc,
Ticket`. `Line` is a **shared counter across everyone counting concurrently** on their own
Ticket Count screen, not a per-person sequence — if Joe's line lands on 31 and George enters
something on a different PC, George's gets 32, then Joe's next is 33. It carries no
timing/ordering signal per item and must never be used as a "which entry is newer" heuristic.
`Location` is **NISC's own internal location concept**, not the item's physical location —
same generic warehouse string on every row regardless of where the item actually sits.
`Sub Location`/`Sub Location Desc` simply aren't in use yet (always blank today), not
necessarily meaningless forever. **The real physical/shelf location lives in `Ticket`**,
because the counter records the human-readable shelf location there instead of scanning the
actual location barcode. Confirmed decode rules:
- Plain digits (`7900`, `4000`, `1200`, ...) → TIM location = `"WH0" + ticket` (e.g. `7900`
  → `WH07900`, `4000` → `WH04000`). Verified against every real TIM location code seen this
  cycle with zero exceptions.
- `CT` + digits (`CT10`–`CT18`) → wheeled warehouse carts, real barcodes `WHCT10`–`WHCT18`
  → TIM location = `"WH" + ticket` (no zero inserted, unlike the plain-digit case).
- `W02` → also a real location, barcode `WHW02` → same `"WH" + ticket` rule as the CT carts.
- Bare names (`VIRGIL`, `STEVE S`) → **not a real location.** These are individuals who took
  material without a proper charge-out; the "location" is recorded as the person's name so
  a spot-check knows who to ask. No barcode exists for these — don't try to force them
  through the WH-prefix rules. Likely need a manual-review bucket rather than an auto-import
  rule, since there's no closed set of employee names to detect this against — anything that
  doesn't match the plain-digit or letter-prefix-digit code shapes should probably be flagged
  for a human to assign a location (or a "checked out to" pseudo-location) rather than guessed.
- One trailing garbage row per export (blank Item, qty 0) — filter out.
- ~32 rows per export have `Quantity = 0` — these are real "counted, none on hand" results
  (NISC pre-lists every catalog item ever assigned to a location), not missing data. They
  should still override TIM's count to zero, not get silently skipped.

**Confirmed duplicate handling:** ~17 rows per export repeat the same Item+Ticket pair, most
with differing quantities (one pair was 49 vs 0 for the same SKU/location). **Sum
quantities** for matching Item+Ticket pairs before importing — this isn't just our own
convention, it's what NISC itself does natively: NISC allows the same item to be entered on
multiple lines (by one person adding to their own count, or by multiple people counting the
same ticket concurrently — see the `Line` note above) and adds them together when the count
is submitted (e.g. `10117` entered as qty 3 on one line and qty 1 on another submits as 4).
The importer should replicate that same accumulation, not treat a duplicate as a correction.

**Confirmed override semantics: Cumulative vs Replace, chosen by the user per import —
mirrors a feature NISC itself already has.** NISC lets you update a count in either mode:
Cumulative adds the imported qty to whatever TIM already has for that item+location;
Replace overwrites it outright. No date/timestamp guessing needed (there likely isn't one
reliably available anyway, since `Line` carries no timing signal) — the user just picks the
mode for the whole import, same mental model they already use in NISC. **Replace** should
void the prior `bulk_quantity_count` event(s) for that item+location and create a fresh one
(same audit-trail pattern as the reel importer's supersede-on-update and the box-void
pattern), not silently overwrite a number. **Cumulative** adds a new event on top without
voiding anything — functionally identical to Replace on a first-time count with nothing on
record yet.

**Toggle scope: confirmed whole-import**, matching NISC's own behavior exactly (pick a mode
per submission, not per line) — deliberately keeping the mental model identical to what
NISC already trains people on, to avoid a second, different set of rules to remember.

**Reel importer note — correction:** reel data is genuinely, reliably timestamped (captured
via a custom Odoo screen, one timestamp per update) — unlike NISC bulk exports, which have
no usable per-row date at all. So the reel importer's date-based supersede logic isn't a
data-quality workaround, it's built on real data, and that timestamp has independent value
(audit trail, "when was this last verified") worth keeping regardless of any Cumulative/
Replace addition. The only actual landmine is its narrow **fallback for the rare row that's
missing a date** ("no usable date? only treat it as an update if the new qty is smaller") —
that's the one piece worth reconsidering, e.g. falling back to an explicit Cumulative/
Replace choice instead of guessing, rather than replacing the date logic wholesale.

### Pallet / package grouping — scan boxes onto a larger unit
**Want:** Once devices are scanned into their boxes (existing box feature), scan multiple
boxes onto a larger "pallet" unit that's shrink-wrapped and barcoded. If the pallet isn't
pre-labeled, TIM generates an ID for it — same idea as the box-ID generation already on
the box feature's deferred list, just one aggregation level up (box → pallet).

**Why (pain):** Lots of boxes live on upper warehouse shelving that requires climbing into
the shelving to reach. Once boxes are stacked and wrapped onto a pallet, being able to scan
the pallet ID (instead of re-climbing to touch every individual box) to record a location
move or spot-check contents would remove a real physical/safety pain point.

**Key decisions (confirmed by Joe):**
- A pallet is its **own trackable entity with its own location** — not just a label applied
  to a set of boxes. It has to be scannable/movable independent of the boxes it contains,
  same as boxes are independent of the serials inside them.
- **Opening a pallet invalidates it.** Once a pallet is opened and any item/box is removed,
  the pallet record is done — every box that was on it reverts to being tracked as an
  individual box again. There's no "pallet with 8 of 9 boxes left" partial state; it's
  sealed-and-whole or dissolved back to its boxes.
- **Dissolving a pallet creates an audit record** — same precedent as a voided box listing
  the serials it contained: dissolving lists the boxes (and their serials) moving out of
  the pallet back into the warehouse as individually-tracked units, so the pallet's history
  isn't silently lost when it stops existing as an entity.
- **Open design question (not yet decided):** record granularity on dissolve — one record
  per box with a pointer back to that box's own already-recorded serial manifest (avoids a
  second source of truth for the same serials), vs. one record per box that also re-lists
  its serials inline (self-contained/readable in a flat CSV export, at the cost of
  duplicating data). Decide when this gets built, not before.

**Dependency: blocked on the box feature first.** Don't start until box-level scanning is
solid — see [[project_box_counting]] for the box-registry issues already found/fixed this
cycle (v2.29.09/v2.29.10) and its own still-deferred box-ID generation. A pallet layer on
top of a shaky box layer just compounds the same bugs one level up.

### GitHub Sync Phase 3 — automatic sync
Background push on data changes (debounced), pull on app focus, offline queue, sidebar
sync indicator, record-level merge (needs stable history record IDs; `updated_at` on
product entries already in place since v2.03.00).

### Durable backup on inventory finalize
**Motivation:** `invFinalizeSession` merges the closed session into `appData` in memory
and downloads a master JSON, but — unlike the Receiving commit actions — it does NOT
persist `inventory_sessions`/`inventory_events` to local cache and does NOT auto-push to
GitHub. The downloaded file is the *only* durable copy. If that download is silently
blocked (iOS download/popup blocking), the user still sees a "Session finalized" success
message but the finalized merge is lost on reload (the active session is recoverable via
auto-restore; the merged result is not). v2.12.03 added a guard against finalizing with
no master loaded (catastrophic-overwrite case), but the no-durable-backup gap remains.
**Proposed:** mirror Receiving — persist `appData` (or at least the inventory arrays) and
auto-push on finalize, so a blocked download can't silently lose a count. Spec the sync
implications before building.
