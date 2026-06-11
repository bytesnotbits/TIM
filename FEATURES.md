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

## Planned

### GitHub Sync Phase 3 — automatic sync
Background push on data changes (debounced), pull on app focus, offline queue, sidebar
sync indicator, record-level merge (needs stable history record IDs; `updated_at` on
product entries already in place since v2.03.00).
