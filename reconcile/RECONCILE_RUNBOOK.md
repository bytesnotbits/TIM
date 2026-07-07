# Cycle-Count → Odoo Reconciliation Runbook

How to turn a physical cycle count into applied Odoo inventory adjustments. Written after the
2026.2 count so it can be repeated in ~3 months without re-figuring everything out.

**Golden rule that saved us repeatedly:** the Odoo import step is finicky and occasionally buggy.
Never trust it blindly — **after every import, export the staged state and verify it with the
pipeline's checks BEFORE you click Apply.** The math, not the screen, is the source of truth.

**Do the three inventory types SEPARATELY, in this order: Serialized → Bulk → Reels.** They have
different quirks and mixing them caused mistakes. One type at a time.

---

## 1. Gather the inputs (all into `docs/`)

| File | Where it comes from | Notes |
|------|--------------------|-------|
| `2026.X cycle count full count minus reels.csv` | The cycle-count Google Sheet (from NISC export) | Everything counted except reels. **Row 1 MUST be the column header** — Google Sheets copy/paste sometimes drops it; the pipeline will error loudly if it's missing. Required columns: `Item`, `Lot/Serial`, `QuantitySum`, `Ticket` (Ticket = the count's bin/location code). |
| `2026.X full reel count.csv` | Reel count sheet | Columns: `Description` (`[item] name`), `Reels No`, `Quantity` (feet). |
| `Quants (stock.quant)SERIALS.csv` | Odoo export, serialized devices only | See filters below. |
| `Quants (stock.quant)REELS.csv` | Odoo export, reels only | |
| `Quants (stock.quant)BULK.csv` | Odoo export, bulk only | |
| `Product Moves (Stock Move Line) (stock.move.line).csv` | Odoo export | Moves since the count. |
| `Inventory Locations (stock.location).csv` | Odoo export | The **`Barcode`** field = the count's `Ticket` code. This is the location crosswalk. |
| `product_id_overrides.csv` | Hand-maintained | `id,default_code` for counted items that have **zero** on-hand in Odoo (so they never appear in a quants export). Append new ones as needed. |

### Odoo export filters (saved filters — verify/adjust each cycle)

- **Quants (each type):** filter to the inventory category, e.g. `product_categ_id ilike "inventory"`,
  and scope to the type (serialized devices / reels / bulk). *(The `is_reel` boolean was expected to
  split reels but didn't work as hoped in 2026.2 — Joe produced three separate scoped exports instead.
  Either approach is fine as long as the three files don't overlap.)*
- **Moves:** `state = done` AND `product_category_name ilike "inventory"` AND `date >= <count date/time>`
  AND operation type in **{WH: Charge-Out, WH: Returns, WH: Receiving, WH: RMA(in)}**.
  - Charge-Out is the only outbound path today. The pipeline's co-currency check will flag it if a
    future outbound type (Delivery Order, Scrap, Internal Transfer out) ever slips through.
- **Include column:** when exporting quants you intend to *update* by import, consider adding the
  **External ID** column (see the import section) — though in 2026.2 we applied via the on-screen
  physical-inventory grid, not an update-by-ID import.

### Co-currency requirement (important)
Export the **quants and the moves at the same time** (same session). The count is "as of" the count
date; the reconciliation rolls it forward using moves. If the quants is fresher than the moves, a unit
that shipped in the gap looks like it's still here and can get re-added. The pipeline checks this.

---

## 2. Run the pipeline

```
node reconcile/run_reconcile.js
```

It validates the count header (errors loudly if row 1 isn't the header), classifies serial/bulk/reel,
applies the barcode location crosswalk, rolls the count forward by the moves, and writes:

| Output | What it is |
|--------|-----------|
| `1_change_since_count.csv` | Every move since the count (in/out). |
| `6_reconciliation_bulk.csv` | Bulk: counted vs Odoo per (item, location). |
| `8_IMPORT_serialized_adjustment.csv` | Serialized **delta** (zeros + adds only). |
| `13_IMPORT_serialized_FULL.csv` | Serialized **full** (every counted serial + zeros) — audit-trail version. |
| `9_IMPORT_bulk_adjustment.csv` | Bulk import (positive diffs; count=0 rows held out). |
| `10_IMPORT_reels_matched.csv` | Reel footage updates (matched reels). |
| `11_REVIEW_reel_exceptions.csv` | Reel adds / renames / zeros needing human review. |
| `12_reel_placement_audit.csv` | Reels in the wrong Reels/Reelx bin for their footage. |

Read the SUMMARY the script prints — it reports the serialized zero count, bulk import rows, missing
Product/IDs, unmapped locations, and reel exception counts.

---

## 3. The Odoo import + apply (per type)

Screen: **Inventory → Operations → Physical Inventory** (a.k.a. Inventory Adjustments). Import via the
gear/cog next to the title → **Import records**.

### Traps we hit (read before importing)
1. **Duplicate identifiers.** Odoo rejects an import that maps two product identifiers. The files
   contain both `Product` (readable) and `Product/ID`. On the mapping screen set **`Product` → "Don't
   import"** and map only **`Product/ID`**.
2. **Importing a count of `0` does NOT zero a line.** Odoo reads an imported `0` as "not counted" →
   Difference stays 0 → Apply does nothing. **To zero uncounted lines, set the count on the
   physical-inventory grid (not via a `0` in the import)** so the Difference registers as −1.
3. **Phantom duplicate rows.** An import can create duplicate quant lines (on-hand 0, counted N) instead
   of updating existing ones — the row count balloons and matches show Difference +1. These are **not
   committed**. **Recovery: Operations → Physical Inventory to reload the view; the phantom rows vanish.**
   Real on-hand is untouched as long as you did **not** Apply.
4. **Location codes.** The count's `Ticket` (e.g. `WH04900`, `WHCT14`) is the Odoo location's **Barcode**,
   which maps to the full path (`W367/S/4900`). The pipeline handles this; just know it if you map by hand.

### The safe apply sequence (this is the part that matters)
1. Import the type's file. If phantom rows appear, reload (trap #3) and sort out the mapping.
2. Set the counts (import for the matches/positives; **grid entry for zeros** per trap #2).
3. **Export the staged, not-yet-applied state** and hand it to the reconciler for verification:
   - No duplicate (product+lot+location) rows.
   - Every non-zero difference is the type you're working (no bulk/reels swept into a serial apply).
   - **Post-apply simulation** (final on-hand = Counted Quantity per line): every counted-present unit
     ends at its correct qty, nothing doubled, nothing counted/received wrongly removed, no negatives.
4. **Review exceptions case-by-case with warehouse knowledge** — e.g., orphaned units from closed sales
   orders *should* be zeroed even if they're in transit; the pipeline can't know an SO is closed.
5. **Filter to your type, select those lines, and click Apply on the selection** — NOT the global
   "Apply All" button (that commits every staged difference across all types).
6. **Export "after applied" and re-verify** the final state matches the simulation.

### Remember about the "Counted Quantity" column
On Apply, each line's on-hand **becomes** its Counted Quantity. So Counted is the *resulting* on-hand.
There are never negatives in Counted, so any negative in the live on-hand column gets overwritten to its
Counted value on Apply.

---

## 4. Known pre-existing data issues (not caused by the count)
- **Negative on-hand quants** exist in Odoo independent of the count (e.g. item 710 @ `W367/S/4000` = −7).
  These are bulk/reel and were negative in the earliest exports. Clean them up in the bulk/reel runs; a
  count adjustment papers over them but doesn't explain them.
- **Serials created with no quantity / absent from NISC** (e.g. `&lt;example-serial-id&gt;`) — data artifacts; leave
  at 0 rather than forcing them on-hand.
- **Serials dispersed across multiple orders / double-located** — bad lot history; zero manually.

---

## 5. Status log
- **2026.2 Serialized:** APPLIED 2026-07-07. 1,909 devices on-hand; all counted-present serials kept;
  0 negatives/doubles. Clean.
- **2026.2 Bulk:** not yet applied.
- **2026.2 Reels:** not yet applied (exceptions file needs review first).

---

## 6. The long-term goal
This whole file-shuffling dance is the argument for building the workflow into TIM (the reconciliation
engine is portable into the browser) and eventually TIM ↔ Odoo direct integration. See the project
memory for that roadmap.
