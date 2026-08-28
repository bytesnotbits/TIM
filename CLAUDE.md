# CLAUDE.md

> **Global working style + Joe's leadership/review-record mandate** are defined once in the
> workspace-root `CLAUDE.md` (`C:\Users\jherring\CLAUDEworkspace\CLAUDE.md`) and apply here
> automatically. This file covers TIM specifics only.
>
> **SESSION START:** Begin by reading `TOC.md` and following its SESSION START line — orient before acting, and report what you're about to work on before editing.

## What TIM is

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

TIM ("Telecom Inventory Manager") is a **vanilla-JS PWA** for warehouse receiving, physical inventory counts, and product-catalog management at a telecom. It ingests vendor/Calix and RMA spreadsheets and Odoo exports, and produces CSV/XLSX files to import back into Odoo. There is **no framework, no build step, and no package.json** — the browser loads `index.html`, `app.js`, and `styles.css` directly. Two CDN libraries are used: `xlsx@0.18.5` (read/write Excel) and `JsBarcode@3.11.6` (render barcodes).

## Running locally

```powershell
npx serve -l 5173 .
```

Then open http://localhost:5173. (See `.claude/launch.json`.) There are no tests, linters, or build commands — verification is manual in the browser. A service worker (`sw.js`) is active, so a hard reload may be needed to pick up changes; local files are served network-first so edits normally appear on reload.

## The four files that do all the work

| File | Role |
|------|------|
| `index.html` | All markup. Inline `oninput`/`onclick` handlers call `app.js` global functions directly. |
| `app.js` | All logic — ~8400 lines, one flat script of global functions. No modules. |
| `styles.css` | All styling. |
| `sw.js` | Service worker. Network-first for local files, cache-first for version-locked CDN. |

**`TOC.md` is the map of `app.js`** — it lists every function grouped by feature area with a one-line purpose. Read it before searching. It deliberately omits line numbers; find any symbol by grepping its name (e.g. `function invProcessScan`, `var _CSV_IMPORT_TYPES`). Keep `TOC.md` in sync when you add, rename, or remove functions.

## Architecture essentials

- **Everything is global.** Functions and state live on the global scope so inline HTML handlers can reach them. Adding a feature means adding global functions + wiring an inline handler in `index.html`. Don't introduce modules/bundling.
- **`appData` is the root data container**: `{ product_map, history, inventory_sessions, inventory_events, barcode_map, odoo_quants, recount_sessions, recount_movements }`. `PRODUCT_MAP` and `BARCODE_MAP` are aliases into it.
- **Persistence is IndexedDB via the `TimDB` key-value wrapper** (`TimDB.get/set/remove`), not localStorage. localStorage holds only UI state (`tim_active_tab`, `tim_sidebar_collapsed`, `tim_username`). See the TOC "Persistence" table for the full key list. Writes are debounced (~500ms) via `schedule*` helpers.
- **Feature areas map to sidebar tabs** (`switchTab`): Data Import, Receiving, Inventory, Products, Product Mapping, Barcodes. The big subsystems are **Receiving/Batch**, **Inventory scanning** (`inv*` prefix), **Recount Manager** (`rc*` prefix), and **CSV Column Mapper** (`_csv*` prefix).
- **Function naming is prefix-based**: `inv*` = inventory session/scanning, `rc*` = post-submission recount manager, `bc*` = barcode assignment, `prod*` = product catalog, `_csv*`/`_*` = internal helpers. Follow the prefix convention when adding to a subsystem.
- **The CSV Column Mapper** (`_showCsvMapperModal`) is the fallback when a dropped CSV can't be auto-detected: the user identifies the data type and maps their columns to TIM's expected field names, then the headers are rewritten and routed to the normal import handler. New import types are added to the `_CSV_IMPORT_TYPES` array.

## Conventions

- **Version string lives in `app.js` as `APP_VERSION`** (e.g. `v2.01.10`) and is stamped into the title/header at load — the `<title>` in `index.html` is overwritten by regex, so the version hard-coded there is stale and doesn't matter. Bump `APP_VERSION` for user-facing changes; commit messages follow `Description (vX.XX.XX)`.
- **Bumping the service worker**: when `sw.js` precache contents or strategy change, bump the `CACHE` constant (`tim-v4` → `tim-v5`) so old caches are evicted on activate. Upgrading a CDN lib means updating the `<script src>` in `index.html` **and** the URL in `PRECACHE`, then bumping `CACHE`.
- **Always `escapeHtml()` user/data values before injecting into `innerHTML`.** Rendering is done by building HTML strings; this is the XSS guard.
- **CSV is parsed/written by hand** (`_parseCsvToRowObjects`, `csvEscape`, `bcParseCsvRow`), and Excel via the `XLSX` global. Field extraction from loosely-structured rows goes through `getField(row, names)` and header detection through `findHeaderRow` (column-name scoring).

## Deployment

Deployed as a PWA on **GitHub Pages** at https://bytesnotbits.github.io/TIM/, used on iPad in the warehouse. **GitHub Pages builds the live site from the `TIM-2.0` branch** — so `git push origin TIM-2.0` is itself the deploy (Pages rebuilds in ~1 min; then "Check for Updates" in-app offers "Reload now"). **`TIM-2.0` is also the repository's default + PR base branch** (changed 2026-08-28 — the project has moved far beyond the original code, and having the old branch as default kept spawning stale worktree bases). `Telecom-Inventory-Manager` is retained as the **legacy/original** branch only: it runs many versions behind, is not merged to, and does **not** affect the live site. (Pages is pinned to `TIM-2.0` regardless of the default setting.) Verify what's deployed by fetching `https://bytesnotbits.github.io/TIM/app.js` and reading its `APP_VERSION`. `manifest.json` must use **absolute** `start_url`/`scope` URLs — relative `./` paths break the PWA on iOS for a GitHub Pages subdirectory repo. An iOS home-screen PWA has isolated storage: clearing Safari data does not clear it; the icon must be deleted and re-added.

## Data files in the repo

The various `.json` / `.csv` / `.txt` files at the root (`source_data_*.json`, `Calix_Odoo_Converter_source_data.json`, `*_FSAN_*.csv`, `Inventory Locations (stock.location).csv`, etc.) are **sample/working data**, not source code — useful as fixtures for reproducing import behavior.
