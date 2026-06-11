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

### GitHub Sync Phase 3 — automatic sync
Background push on data changes (debounced), pull on app focus, offline queue, sidebar
sync indicator, record-level merge (needs stable history record IDs; `updated_at` on
product entries already in place since v2.03.00).
