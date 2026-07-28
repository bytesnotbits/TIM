# TIM — Codebase Table of Contents

> **How to use this file:** All symbols live in `app.js` unless noted otherwise.
> To find any function, grep its name: `function functionName` — unique in the file.
> For variables/constants, grep the declaration: `var foo` / `const foo`.
> Line numbers are intentionally omitted — they go stale; grep patterns don't.

---

## Architecture Overview

Single-page PWA. Four files do all the work:

| File | Role |
|------|------|
| `index.html` | All HTML markup; inline `oninput`/`onclick` handlers wire to `app.js` functions |
| `app.js` | All application logic (~8400 lines); no framework |
| `styles.css` | All styling |
| `sw.js` | Service worker: network-first for local files, cache-first for CDN, bypass for api.github.com; cache key `tim-v5` |

### Main Tabs / Feature Areas
- **Receiving** — load vendor/RMA source file, map products, export to Odoo
- **Inventory** — active session scanning (serial, reel, bulk, box, MAC)
- **Products** — product catalog editor (`PRODUCT_MAP`)
- **Product Mapping** — barcode-to-item assignment
- **Barcodes** — barcode batch management

### Data Flow
```
loadJsonFile() → loadSourceData() → appData { product_map, history, odoo_quants, recount_sessions, recount_movements }
readSourceWorkbook() → processRows() → currentBatch[]
                                     → renderAll()
invCreateEvent() → invEvents[] → scheduleInvAutosave() → TimDB (IndexedDB)
invAutoRestoreSession() ← TimDB (on page load)
invProcessOdooQuantCsv() → invQuantsBaseline[] → invSaveQuantsBaseline() → TimDB
rcConfirmCreate() → rcSessions[] → rcSaveStorage() → TimDB
```

### Persistence (IndexedDB via `TimDB`)
| Key | Contents |
|-----|----------|
| `calix_inv_session_v1` | Active inventory session + events |
| `tim_master_cache_v1` | product_map + history cache |
| `tim_barcode_map_v1` | Barcode→item map |
| `calix_batch_draft_v1` | In-progress receiving batch |
| `tim_odoo_quants_baseline_v1` | Quants baseline (on-hand quantities from Odoo) |
| `tim_location_map_v1` | Location path→barcode map |
| `tim_location_barcode_map_v1` | Location barcode→complete name map |
| `tim_recount_v1` | Recount sessions + movement records |
| `tim_recount_count_v1` | Recount worklist: imported physical count `{ rows, importedAt, fileName }` |
| `tim_recount_moves_v1` | Recount worklist: imported Odoo product movements `{ rows, importedAt, fileName }` |
| `tim_recount_nisc_v1` | Recount worklist: imported NISC capture (bulk/reels/serials, upserted by item) `{ rows, importedAt, fileName }` |
| `tim_gh_config_v1` | GitHub sync config `{ owner, repo, branch, autoLoad }` |
| `tim_gh_token_v1` | GitHub fine-grained PAT (Contents: read on the data repo) |
| `tim_gh_shas_v1` | Per-file blob SHAs from last GitHub sync (for Phase 2 write-back) |
| `tim_catalog_health_v1` | Catalog Health review state `{ ignored: { extId → true } }` (dismissed alias groups) |
| `tim_nisc_catalog_v1` | NISC catalog master layer `{ item → {name,long_desc,group,status,class,class_source,…} }` (device-local; feeds dup-check + numbering) |
| `tim_numbering_db_v1` | AABBCC-N numbering legend, seeded from bundled `numbering_db.json` (occupancy computed live) |

`localStorage` stores only UI state: `tim_active_tab`, `tim_sidebar_collapsed`, `tim_username`, `tim_voice_enabled`.

---

## Key Global Variables

| Variable | Purpose |
|----------|---------|
| `APP_VERSION` | Version string shown in UI |
| `appData` | Root container: `{ product_map, history, inventory_sessions, inventory_events, barcode_map, odoo_quants, recount_sessions, recount_movements, external_count, product_movements, nisc_capture, boxes }` |
| `PRODUCT_MAP` | Alias for `appData.product_map` — item definitions keyed by item number |
| `BARCODE_MAP` | Alias for `appData.barcode_map` — barcode→item lookup |
| `currentBatch` | Rows being processed in current receiving batch |
| `blindQueue` | Devices queued for blind receiving |
| `invSession` | Active inventory session object (null if none) |
| `invEvents` | Events in active session (current scan session only) |
| `invExceptions` | Exception events in active session |
| `invSequence` | Monotonic event sequence counter |
| `invScanMode` | `"auto" \| "serial" \| "reel" \| "item"` |
| `invCurrentLocation` | Sticky scan location |
| `_invAutoRestoreStarted` | Flag preventing hint/restore race on load |
| `INV_STORAGE_KEY` | `"calix_inv_session_v1"` |
| `INV_QUANTS_BASELINE_KEY` | `"tim_odoo_quants_baseline_v1"` |
| `INV_LOCATION_MAP_KEY` | `"tim_location_map_v1"` |
| `INV_LOCATION_BARCODE_MAP_KEY` | `"tim_location_barcode_map_v1"` |
| `invQuantsBaseline` | Array of quant rows loaded from Odoo export |
| `invLocationMap` | Path→barcode lookup built from location CSV |
| `invLocationBarcodeMap` | Barcode→complete name reverse lookup |
| `RC_STORAGE_KEY` | `"tim_recount_v1"` |
| `rcSessions` | Array of recount session objects |
| `rcMovements` | Array of recount movement records |
| `rcView` | `"list" \| "create" \| "detail"` |
| `rcActiveId` | recountId of session shown in detail view |
| `rcCreateGapItems` | Pre-populated items from a gap report |
| `rcWfState` | Active workflow modal state `{ recountId, rcItemId, type, scannedSerials[] }` |
| `rcMvState` | Active movement panel state `{ recountId, rcItemId, type }` |
| `rcView` (worklist) | `rcView` also takes `"worklist"` — location-ordered worktable view |
| `RC_COUNT_KEY` / `RC_MOVE_KEY` / `RC_NISC_KEY` | IDB keys for the 3 worklist source files |
| `rcCountMeta` / `rcMoveMeta` / `rcNiscMeta` | `{ importedAt, fileName }` per source file |
| `rcWlSort` | Worklist sort `"location" \| "item"` |
| `rcWlIsolate` | Worklist single-item isolate filter (UPPER item; `""` = all) |

---

## Functions by Area

### Utilities & Helpers

| Function | Purpose |
|----------|---------|
| `$(id)` | `document.getElementById` shorthand — grep `const $ =` |
| `normalize(v)` | Trim + lowercase string |
| `normKey(v)` | Uppercase + trim for key comparison |
| `normalizeProductKey(v)` | Like `normKey` but also strips fancy dashes/spaces |
| `sanitizeScannerValue(v, opts)` | Strip control chars; optionally uppercase |
| `normalizeMacForComparison(v)` | Strip MAC separators for comparison |
| `looksLikeMac(v)` | Validate MAC format |
| `escapeHtml(v)` | HTML-escape for safe innerHTML injection |
| `csvEscape(v)` | Quote CSV fields with special chars |
| `downloadText(filename, text, type)` | Trigger browser file download |
| `getField(row, names)` | Flexible field extraction from row object |
| `commonValue(values)` | Most frequent value in array |
| `alphaPrefix(v)` | Extract leading alpha chars from string |
| `invNow()` | Current ISO timestamp |
| `invFormatTime(iso)` | `HH:MM:SS` from ISO string |
| `invFormatDateTime(iso)` | Locale datetime from ISO string |
| `invGenerateId(prefix)` | Unique ID (`prefix_timestamp_random`) |
| `invGenerateSessionId()` | Session ID with date component |

---

### Storage / IndexedDB (`TimDB`)

| Function | Purpose |
|----------|---------|
| `TimDB.get(key)` | Read from IndexedDB — grep `TimDB` |
| `TimDB.set(key, val)` | Write to IndexedDB |
| `TimDB.remove(key)` | Delete from IndexedDB |
| `saveBatchDraft()` | Persist receiving batch to IDB |
| `clearBatchDraft()` | Delete receiving batch from IDB |
| `loadBatchDraft()` | Restore receiving batch from IDB |
| `restoreBatchDraft()` | Load batch + refresh UI |
| `timLoadMasterCache()` | Restore the FULL dataset (all appData collections) from IDB on startup — data only, NO render (boot renders once via sync or `timRenderRestored`) |
| `timSaveMasterCache()` | Persist the FULL dataset (`buildExportPayload()` shape) to IDB — not just product_map/history, so a refresh's merge doesn't read missing collections as deletions |
| `timRenderRestored()` | Render the UI from already-restored in-memory data; called on boot branches that don't run a full sync (offline/unconfigured/auto-sync off/failed sync). Sets `_timRendered` |
| `timShowBootOverlay(msg)` / `timSetBootOverlay(msg)` / `timHideBootOverlay()` | Full-screen boot loading overlay. `timSetBootOverlay` only updates text while showing (no-op post-boot, so a manual Sync never flashes it) |
| `timBootBegin(steps)` / `timBootStep(id,status,frac)` / `timBootEnd()` | Boot progress controller: step checklist + overall bar/percentage in the overlay. `status` = running/done/skipped; `frac` gives a running step its own % (e.g. X-of-N file downloads). All no-ops once boot ends (`_bootProg` cleared) — so the same instrumentation in `ghSyncNow` is silent on a manual Sync |
| `_bootRenderCacheStep()` | No-sync boot branches: mark network steps skipped, render cached data under the "render" step |
| `_bootArmWatchdog()` / `_bootClearTimers()` / `BOOT_SLOW_MS` / `BOOT_STUCK_MS` | Stall detection (escalating, never auto-hides): after `BOOT_SLOW_MS` (12s) of no progress shows a "still working…" note; after `BOOT_STUCK_MS` (45s) surfaces a visible stall notice + Reload. Both re-arm on every step, so they fire on genuine inactivity only — scales with data size. A *synchronous* hang can't fire them (timer can't run while the thread is blocked); the browser surfaces that itself |
| `_bootShowStuck()` / `_bootHideStuck()` / `_bootSetNote(msg)` | Toggle the visible stall banner / reassurance line in the overlay |
| `_nextPaint()` | Resolve after two RAFs — flush a progress update to screen before a synchronous, repaint-blocking step (merge/render) |
| `_bootSettle(ms)` / `_bootMarkAndSettle(id,status,frac)` / `BOOT_STEP_SETTLE_MS` / `BOOT_FINAL_HOLD_MS` | Brief deliberate pauses (boot only) so the fast final steps (merge/render/finalize) are visibly seen ticking to done, plus a hold at 100% before the overlay leaves. `_bootMarkAndSettle` is a no-op delay post-boot (`_bootProg` null) so a manual Sync is never slowed |
| `invLoadStorageRaw()` | Raw IDB read for current session |
| `invStorageAvailable()` | Check IndexedDB availability |
| `scheduleInvAutosave()` | Debounced (500ms) autosave trigger |
| `invAutosave()` | Write session snapshot to IDB |

---

### CSV Column Mapper

> Shown automatically when TIM can't auto-detect a dropped CSV. Lets the user identify the data type and map their columns to TIM's expected field names before routing to the normal import handler. Reads up to 10 sample values per column and displays them as chips below each dropdown.

| Function / Variable | Purpose |
|---------------------|---------|
| `_CSV_IMPORT_TYPES` | Array of import type definitions — grep `var _CSV_IMPORT_TYPES` |
| `_csvMapperFile` | File object held for the deferred import read |
| `_csvMapperCols` | Detected column names from the dropped file |
| `_csvMapperSampleData` | `{ colNameLower: [val, …] }` — up to 10 sample values per column, built from first 8 KB |
| `_csvEsc(s)` | HTML-escape helper scoped to the mapper |
| `_parseCsvToRowObjects(text)` | Parse CSV text into `[{ header: value }]` row objects; used by Receiving `run()` |
| `_showCsvMapperModal(file, cols)` | Open the mapper modal; fires async sample-data read, renders type cards + column pills |
| `_csvMapperUpdatePreview(sel)` | Refresh the sample-value chip strip below a mapping `<select>` |
| `_csvMapperBuildFields(cols, typeId)` | Populate Step 2 mapping table; auto-matches columns by name; wires preview listeners |
| `_csvMapperDoImport()` | Validate mapping, run type-level `validate()` hook, rewrite headers, call `run()` |
| `_remapCsvHeaders(text, mapping)` | Rewrite CSV header row using `{ csvColLower → fieldKey }` mapping |

---

### Data Loading (Master JSON + Source File)

| Function | Purpose |
|----------|---------|
| `loadJsonFile(file)` | Parse master JSON file |
| `loadSourceData(parsed, fileName)` | Ingest parsed master: populate `appData`, infer missing products, load quants + recount data |
| `inferProductMapFromHistory(records)` | Auto-create product entries from history records |
| `readSourceWorkbook(file)` | Read vendor or RMA source Excel/CSV |
| `readWorkbook(file)` | Parse Excel/CSV → array of row objects |
| `readWorkbookRawRows(file)` | Parse Excel/CSV → raw cell arrays |
| `readRmaWorkbook(file)` | Parse RMA-format workbook |
| `findHeaderRow(rawRows)` | Detect header row by column name matching (score ≥ 3) |
| `rowsToObjects(rawRows, headerIdx)` | Convert raw rows → keyed objects |
| `parseRmaRows(rawRows)` | Parse RMA header/item row structure |
| `excelDateToISO(v)` | Convert Excel date serial → ISO string |

---

### GitHub Data Sync (`gh*`)

> Pull + push of shared master data against a private GitHub repo's `data/` folder, authorized by a fine-grained PAT stored in IndexedDB. Files: `product_map.json`, `barcode_map.json`, `quants.json`, `recounts.json`, `inventory.json`, `history-<year>.json` shards. **Pull** uses the REST Contents API (raw media type for >1 MB files) and is atomic in memory (current data is only replaced after every fetch succeeds). **Push** uses the Git Data API — blobs → tree → commit → ref — so all changed files land in one atomic commit (a drop mid-push leaves the repo untouched); unchanged files are skipped by comparing locally computed git blob SHAs against the repo listing. Conflicts (repo changed since last pull) require explicit overwrite confirmation in a **manual** push and are **blocked** in an **auto** push. The three history-commit actions (Mark as Imported / Append to History, Add Batch to History Only, Merge Existing Records) fire an auto push; offline / timed-out pushes are deferred via `GH_PENDING_KEY` and flushed on the `online` event. All fetches are timeout-bounded (`ghFetch`). The service worker bypasses `api.github.com` so responses are never cached. **Planned next:** union auto-merge of concurrent changes (keep both sides; escalate only same-record edits).

| Function / Variable | Purpose |
|---------------------|---------|
| `GH_CONFIG_KEY` / `GH_TOKEN_KEY` / `GH_SHAS_KEY` / `GH_PENDING_KEY` / `GH_BASE_KEY` / `GH_CONFLICTS_KEY` | TimDB keys — grep `const GH_CONFIG_KEY`; `GH_PENDING_KEY` = unpushed-changes flag; `GH_BASE_KEY` = last-synced payload (3-way merge base); `GH_CONFLICTS_KEY` = local conflict log |
| `ghConflictLog` | In-memory conflict-log array; mirrors `data/conflicts.json` |
| `ghLoadConflictLog()` / `ghSaveConflictLog()` | Load/persist the conflict log (TimDB) |
| `ghUnresolvedConflictCount()` | Count of `status !== "resolved"` entries (still need a choice) |
| `ghUnpublishedResolvedCount()` | Count of resolved-but-not-yet-pushed entries (still editable) |
| `ghPendingConflictCount()` | Unresolved + unpublished-resolved (drives badge visibility) |
| `ghMergeConflictEntries(incoming)` | Fold new/pulled conflict entries into the log, deduped by `conflictId` (resolved wins) |
| `ghConfig` / `ghToken` | In-memory settings `{ owner, repo, branch, autoLoad, deviceLabel }` + PAT |
| `ghConfigured()` | True when token + owner + repo are set |
| `ghSetStatus(msg, state)` | Update sync status line on the Data Import card |
| `ghTestingMode()` / `ghSetTestingMode(on)` / `ghToggleTestingMode()` | **Testing mode** (v2.32.03): work against live data but suppress ALL GitHub pushes. Persisted in `localStorage` `tim_testing_mode`. Single guard at the top of `ghPushToGitHub` short-circuits every push (auto + manual); reads/ingest unaffected |
| `ghRenderTestingBanner()` | Reflect testing-mode state → header banner (`#timTestingBanner`) + toggle button (`#ghTestingToggleBtn`); called on load and every toggle so the loud amber banner can't drift from the flag |
| `ghMarkPendingPush()` / `ghClearPendingPush()` | Set/clear the deferred-push flag (local has/has-not changes not yet on GitHub) |
| `ghBindOnlineRetry()` | Bind a one-time `online` listener that flushes a pending push on reconnect |
| `ghHeaders(accept)` | Build auth headers for the GitHub API |
| `ghFetch(url, options)` | `fetch` wrapper with AbortController timeout + 1 retry; normalizes timeout→TypeError so callers defer & retry. All GitHub fetches route through this so a hung connection can't stick `ghSyncInFlight` |
| `ghApi(path, accept, tokenOverride)` | api.github.com GET via `ghFetch` (no-store) |
| `ghLoadSettings()` | Restore config + token from IDB on startup |
| `ghOpenConfig()` / `ghCloseConfig()` | Show/hide the config modal; prefills owner/repo/branch defaults + device dropdown |
| `ghLoadDeviceLabels()` | Load Device Label options + meta from TimDB `tim_gh_device_labels_v1` (migrates legacy array) |
| `_ghPersistDeviceLabels()` / `_ghStampAndSaveDeviceLabels()` | Persist list (no stamp / stamp new `updated_at` + schedule push) |
| `ghDeviceLabelsFile()` | Build the `data/device_labels.json` payload `{labels, updated_at, updated_by}` |
| `ghReconcileDeviceLabels(remote)` | Whole-list newest-wins merge of pulled labels (adopts newer remote only); returns `{adopted, localNewer}` |
| `ghPublishDeviceLabels()` | Admin "Publish" button — explicit push of the device list (edits stay local until clicked) |
| `_ghRenderDeviceMgrStatus(msg)` | Publish button enable/disable + unpublished-changes hint in the editor panel |
| `_ghRefreshDeviceLabelUI()` | Repopulate dropdown/editor if the config modal is open |
| `timIsAdmin()` | Soft admin gate — sidebar username contains a `TIM_ADMIN_NAMES` entry |
| `ghPopulateDeviceLabelSelect(selected)` | Rebuild the Device Label `<select>`; shows Manage btn to admins |
| `ghToggleDeviceMgr()` / `ghCloseDeviceMgr()` / `ghRenderDeviceMgr()` | Admin inline editor for the device list |
| `ghAddDeviceLabel()` / `ghRemoveDeviceLabel(i)` | Add/remove a device label; stamp + repopulate + schedule push |
| `ghTestConnection()` | GET `/repos/{o}/{r}` with form values; report ok/401/404 |
| `ghSaveConfig()` | Persist settings + token, then sync |
| `ghClearConfig()` | Remove token/config/SHAs from this device |
| `ghListDataDir(allowMissing)` | List `data/` folder contents (names + blob SHAs); `allowMissing` returns `[]` on 404 |
| `ghFetchJsonFile(path)` | Fetch one file as raw JSON (`vnd.github.raw+json`) |
| `ghSyncNow(silent)` | **Main pull = 3-way merge** (v2.06.00): list → fetch all → assemble remote → `ghMergeMasters(base, local, remote)` → `loadSourceData(merged)` → log conflicts + pull repo `conflicts.json` → save base(=remote) & SHAs → mark pending if merged has local-only changes. Atomic; no longer clobbers local. |
| `_ghAssembleRemote(fetched)` | Assemble fetched repo files → `{ payload, conflicts, hadHistoryShards }` (shared by pull + push-rebase) |
| `_ghPayloadDiffers(a,b)` | Cheap per-collection deep-compare; true if merged has changes not yet in the repo |
| `ghInit()` | Startup hook (returns a promise so the boot overlay hides at the right time): load settings; if a push is pending, PUSH (not pull, which would clobber the offline edit), else auto-sync if `autoLoad` + online. Renders the restored cache on every branch that doesn't run a full sync. Runs after `timLoadMasterCache()` resolves |
| `ghHistoryShardName(record)` | `history-<year>.json` from `imported_at`/`ship_date` |
| `ghBuildDataFiles()` | Build `{ fileName → JSON string }` from current data, incl. `conflicts.json` (shared by seed + push) |
| `ghDownloadSeedFiles()` | Download current local data as split repo files (staggered) |
| `_ghUtf8Bytes(str)` / `_ghB64FromBytes(bytes)` | UTF-8 encode / chunked base64 encode |
| `ghBlobSha(content)` | Git blob SHA-1 of a string (for change detection vs repo listing) |
| `ghApiWrite(method, path, body)` | JSON-body POST/PATCH to api.github.com via `ghFetch` |
| `_ghCheckWrite(res, what)` | Shared write-response check; maps 403/404→token perms, 409/422→branch conflict |
| `_ghWriteCommit(repoBase, changed)` | Atomic write of changed files: blobs → tree → commit → ref; returns commit SHA. Shared by normal + rebase push paths |
| `ghPushToGitHub(opts)` | **Main push**: build files → diff SHAs → **on conflict, REBASE** (fetch remote → `ghMergeMasters` → push the merged union; both sides survive, collisions logged to `conflicts.json`) → else confirm (manual) → `_ghWriteCommit`. `opts.auto` skips the confirm; no-ops when unconfigured/offline. Offline / mid-push drop marks pending + defers to reconnect. Saves `GH_BASE_KEY` on success. Prompts for username if blank; commit message includes `deviceLabel` |

---

### Union 3-Way Merge Engine (`ghMerge*` / `_gh3*`)

> Pure, in-memory merge of two diverged master copies against their common base — see **`MERGE_DESIGN.md`** for the full spec. Disjoint changes auto-merge; only the same field set to two different non-empty values is a true conflict (logged, never silently dropped). **Phase 1 (built, fixture-tested, not yet wired into live sync).**

| Function / Variable | Purpose |
|---------------------|---------|
| `PRODUCT_MERGE_FIELDS` / `PRODUCT_ARRAY_FIELDS` / `HISTORY_ARRAY_FIELDS` | Field lists for product-entry / history field-merge; array fields are unioned |
| `_ghStableStringify(v)` / `_ghEqual(a,b)` | Order-insensitive deep stringify + deep equality |
| `_ghFieldEqual(a,b)` | Field compare via `normalize()` (handles strings + booleans) |
| `_ghRecordTs(rec)` / `_ghNewer(l,r)` | Record timestamp (`updated_at`/`imported_at`/`timestamp`/`createdAt`) + newer-of-two |
| `_ghCandidate(rec,field,who)` / `_ghMakeConflict(...)` | Build a conflict candidate / a conflict-log entry (see `conflicts.json` shape in spec) |
| `_ghMergeRecord(key,base,l,r,cfg,ctx,out)` | Resolve a both-changed key: field-merge (records) or scalar conflict; pushes conflicts to `out` |
| `_gh3MergeKeyed(base,l,r,cfg,ctx,out)` | 3-way merge of a keyed object (add/edit/delete/edit-vs-delete logic) |
| `_ghToMap(arr,keyFn)` | Index array by key; returns `{ map, keyless }` (keyless items never dropped) |
| `_gh3MergeArray(base,l,r,cfg,ctx,out)` | 3-way merge of a keyed array; preserves local-then-remote order + keyless passthrough |
| `ghMergeMasters(base,local,remote,ctx)` | **Orchestrator**: merges every collection → `{ merged, conflicts }`. `odoo_quants` not merged (newest wins) |

---

### Conflict Review UI (Phase 3, v2.08.00)

> Sidebar **Conflicts** nav item (hidden until `ghUnresolvedConflictCount() > 0`) with a red count badge → opens the review modal (`#ghConflictsModal`). Each conflict shows location + candidate values with provenance; clicking **Keep this** resolves it. Resolving writes the chosen value into the master, marks the entry resolved, and marks the push pending. When the **last** conflict is resolved it auto-pushes (Joe's rule); while some remain, **Push resolved now** publishes the resolved subset.

| Function / Variable | Purpose |
|---------------------|---------|
| `_GH_ARRAY_ID_FIELDS` | Map of array collection → id field, for resolution write-back |
| `ghRenderConflictBadge()` | Show/hide the sidebar Conflicts item + update count; called on load, sync, push, resolve |
| `ghOpenConflictsModal()` / `ghCloseConflictsModal()` | Show/hide the review modal |
| `_ghFmtConflictVal(v)` | Format a candidate value for display (deleted/empty/object/scalar), escaped |
| `_ghFieldLabel(field)` / `_GH_FIELD_LABELS` | Plain-English field name for review (e.g. `serial_tracked` → "Serial-number tracking") |
| `_ghFmtFieldValue(field, v)` | Plain-English value (e.g. `serial_tracked` true → "Tracked by serial number"); null = no friendlier form |
| `_ghConflictContext(e)` | Friendly `{noun, title, subtitle, aside}` header for a conflict. For product_map: leads with NISC item # (`hctc`) + description (`name`); shows the part-number key as `(part …)` aside when it differs |
| `_ghCandidateWho(cand)` | Who set a candidate, in user terms ("Joe" / "the shared database") |
| `ghRenderConflictsList()` | Render conflict rows (needs-review → resolved → published) with friendly labels + footer/Publish button |
| `ghApplyResolution(entry, chosen)` | Write the chosen value back into the in-memory master (by collection/key/field; null = delete) |
| `ghChooseCandidate(conflictId, idx)` | Pick/re-pick the value to keep: apply + save locally + re-render. No push; editable until `published` |
| `_ghMarkResolvedPublished()` | After a successful push, set `published:true` on resolved entries (locks them) |
| `ghPushResolved()` | "Publish choices" — push resolved choices (+ other local changes) to the repo |

---

### Product Map Lookups

| Function | Purpose |
|----------|---------|
| `findProductMapMatch(product)` | Find entry by key, HCTC, default_code, or vendor-PN `aliases[]` — returns `{ key, entry, matchedBy }` (`matchedBy: "alias"` for folded vendor PNs) |
| `findProductMapEntry(product)` | Wrapper returning just the entry |
| `resolveCalixProduct(input, mapMatch)` | Resolve final product name with history fallback |
| `findHistoryProductByHctc(hctc)` | Resolve product name from history by HCTC |
| `getMapVendor(map)` | Extract vendor from map entry |
| `getMapDescription(map)` | Extract name/description from map entry |
| `getMapExternalId(map)` | Extract Odoo external ID |
| `mapRequiresFsan(map)` | Check if FSAN required |
| `mapHistoryOnly(map)` | Check if history-only (DNI) |
| `getTrackingType(map)` | Returns `"serial" \| "reel" \| "none"` |
| `validateProductMapEntry(map)` | Validate entry for export (serial-tracked, ext ID, etc.) |
| `countBlockedTemplateMappings(productMap)` | Count entries with product_template IDs (invalid) |

---

### Receiving / Batch Processing

| Function | Purpose |
|----------|---------|
| `processRows(rows)` | Core: map source rows → batch entries with validation |
| `previewMerge(existing, incoming)` | Detect merge conflicts |
| `mergeMissingFields(existing, incoming)` | Fill in missing fields from new row |
| `buildIndexes(records)` | Build serial/FSAN/MAC dedup sets |
| `buildHistorySerialIndex(records)` | Serial→record lookup index |
| `inferPatternProfile(product, map)` | Infer expected serial/FSAN pattern from history |
| `collectPatternWarnings(fields)` | Validate scan values against expected patterns |
| `formatPatternWarnings(warnings)` | Format warnings as HTML chips |
| `historyForProduct(product, map)` | Filter history records for a product |
| `renderSummary()` | Render batch stats |
| `renderBatch()` | Render batch table |
| `renderHistory(records)` | Render history records |
| `renderUnknownProducts()` | Show unmapped products |
| `renderAll()` | Refresh all receiving views |
| `runHistorySearch()` | Search history records |

---

### Blind Receiving

| Function | Purpose |
|----------|---------|
| `handleScannerEnter(e)` | Keyboard handler for blind scan fields |
| `getBlindDeviceValues()` | Extract + sanitize blind form fields |
| `addBlindDeviceToQueue()` | Validate + add device to blind queue |
| `processBlindQueue()` | Merge blind queue into batch |
| `renderBlindQueue()` | Render blind queue table |
| `loadBlindQueueRow(index)` | Load queue item for editing |
| `removeBlindQueueRow(index)` | Remove queue item |
| `findBlindDuplicateConflict(values, editIdx)` | Check for serial/FSAN/MAC duplicates |
| `assertBlindQueueHasNoDuplicates()` | Validate entire queue for dupes |
| `updateBlindLookup()` | Lookup product and show mapping info |
| `saveBlindMapping()` | Save blind product mapping |
| `clearBlindDeviceFields()` | Clear blind entry form |
| `updateBlindPatternHint()` | Show pattern warnings for current blind entry |
| `prefillBlindFromHistory(record)` | Pre-fill blind form from history match |
| `lookupDeviceInHistory(v)` | Find device by serial/FSAN/MAC in history |
| `renderRecentBlindSerials()` | Show recent serials in blind mode |
| `getBlindMap()` | Get current blind product mapping |

---

### Inventory — Session Lifecycle

| Function | Purpose |
|----------|---------|
| `invAutoRestoreSession()` | **Silent auto-restore on page load** from IDB; guards with `_invAutoRestoreStarted` |
| `invStartNewSession()` | Create fresh session + autosave |
| `invResumeSession()` | Manual "Resume Session" button (shows alert) |
| `invClearSession()` | Clear session from memory + IDB; confirm wording branches on closed (already durably merged — safe) vs. active (real data-loss risk); if closed and Gap Analysis hasn't been run for this session — or was run but is now stale because events were added since (`invActiveEventCount()` mismatch) — an extra warning fires first, since clearing empties `invEvents`, which Gap Analysis/`rcOpenCreateFromGaps` read |
| `invFinalizeSession()` | Close session + merge events into master data; persists via `timSaveMasterCache()`/`scheduleInvAutosave()` immediately and auto-pushes to GitHub when configured (same durability pattern as the reel-importer/history-commit actions), falling back to the manual "replace your master file" download only when GitHub sync isn't set up |
| `invGoToRecountManager()` | Sidebar "Recount Manager" button target (enabled once session is closed) — navigates to the Recount subview instead of launching the legacy walkthrough |
| `invResetSessionState()` | Zero out events/exceptions/recounts/sequence |
| `invExportBackup()` | Export session JSON to file |
| `invImportBackup(input)` | Import session from JSON file |
| `invShowStorageHint()` | Show autosave bar hint if saved session found |
| `invCreateEvent(type, data)` | Create + store event; triggers autosave |

---

### Inventory — UI Rendering

| Function | Purpose |
|----------|---------|
| `renderInvSessionUI()` | Top-level: show/hide all session sections |
| `renderInvSessionMeta()` | Update session name/date/counts header |
| `invRenderClosedSessionBanner()` | Show/hide the "Finalized — reviewing a closed count" banner (above the subview cards, visible regardless of which one is active) whenever the loaded session is `closed`; offers Start New / We're Done — Clear, and reminds to run Gap Analysis (and create a recount session if needed) before clearing |
| `renderInvSidebarSession()` | Update sidebar session indicator + stats |
| `renderInvStatusBar()` | Keep sticky toolbar visible; update session name + event count (mode/loc shown by their own controls) |
| `renderInvEventLog()` | Render event log table (filterable) |
| `renderInvSummary()` | Render per-item summary (qty, footage) |
| `renderInvExceptions()` | Render exceptions panel |
| `renderInvActivityFeed()` | Fill the always-visible last-action bar + render the full list (in the history overlay) |
| `invAddActivity(type, msg, detail, beepType)` | Append to activity feed + fire `timFeedback` (tone + flash) |
| `invClearActivityFeed()` | Clear activity feed |
| `invOpenActivityOverlay()` / `invCloseActivityOverlay()` | Show/hide the full activity history overlay (opened from the last-action bar) |
| `invSetScanFeedback(msg, type, detail)` | Show scan result message + log to activity |

---

### Inventory — Scanning Core

| Function | Purpose |
|----------|---------|
| `invProcessScan()` | **Main scan entry point** — reads input, routes to handler. In Serial/FSAN mode, forces `unknown` and coincidental `box_id` classifications (a value colliding with a key in the per-device, unsynced box registry) back to `serial` — an explicit mode choice always wins over an auto-detected box hit |
| `invClassifyScan(raw)` | Detect scan type: `fsan \| box_id \| location \| reel_number \| serial \| item_number \| barcode \| mac \| unknown` |
| `invUpdateDetectedBadge(raw)` | Update scan-type badge in UI |
| `invGetScanMeta(type, value)` | Resolve item/description metadata for scan value |
| `invShowScanMeta(meta)` | Display metadata badge below scan field |
| `invHideScanMeta()` | Hide metadata badge |
| `invClearScanInput()` | Clear scan field + feedback |
| `invSetScanMode(mode)` | Switch `invScanMode`; updates UI + keypad |
| `invSetLocation(loc)` | Set/clear sticky location |

---

### Box Registry — carton/container → device associations (`appData.boxes`)

Maps a scannable container ID (Calix "Carton No." or master carton/bin) → the **devices** inside, so one scan of a sealed box counts all its devices. As of v2.32.00 a box's contents are `expectedDevices: [{serial?,fsan?,mac?,partial?}]` (was a flat `expectedSerials: string[]`), fields mirroring TIM's history identifiers (`serial` = true Calix serial on the box label; `fsan` = the CXNK/FSAN NISC records as the "serial number"; v2.32.01 renamed the field `cxnk`→`fsan`). A device's identity is any of its identifiers. Built by scanning the carton manifest (or the capture modal); overridden on open. Persisted under `BOX_STORAGE_KEY` (`tim_boxes_v1`) + included in master-JSON export/import. GitHub sync deferred. See Data Dictionary for the `BoxEntry` shape.

| Function | Purpose |
|----------|---------|
| `boxGet(boxId)` / `boxAll()` | Look up one box (normalized key) / list all boxes |
| `boxMigrateDevices()` | One-time on-load upgrade: legacy `expectedSerials` → `expectedDevices:[{serial}]`; drops old field. Also called after master-JSON import |
| `boxDeviceList(b)` | A box's `expectedDevices` (migrates on read). All contents reads go through this |
| `boxDevPrimary(dev)` / `boxDevKey(dev)` | Primary identifier (serial→fsan→mac) / its normKey — the device's identity |
| `boxDevKeys(dev)` | All non-empty identifiers normalized (cross-field matching) |
| `boxDevLabel(dev)` | Human label showing every captured id ("S/N … · FSAN … · MAC …") |
| `boxActiveIdCols(devs)` / `BOX_ID_COL_LABELS` | Identifier columns actually in use across a device list (canonical order; serial-only box → just Serial) + their display labels. Drives the row/column device tables in the audit panel and the registry editor (v2.33.00) |
| `boxResolveIdentifiers(value)` | Resolve a scanned id (serial/FSAN/MAC) → `{serial,fsan,mac}` of known siblings via `invBoxResolveDevice`, or null. Powers the modal's auto-fill |
| `boxCapClassify(value)` | PATTERN-ONLY classify an unresolved scan → column key `serial\|fsan\|mac` (CXNK→fsan, formatted MAC→mac, else serial). Drives the unknown-device flow (v2.32.02) |
| `boxCapLearnAssociation(dev)` | WRITE-BACK: a completed unknown association → `history.records` so it resolves globally next time. Fills an existing record's blank ids or creates a minimal `source_type:"box_learned"`, `status:"history_only"` row (resolves, never imports). ≥2 ids required (v2.32.02) |
| `boxNormDev(dev)` / `boxMergeDev(target,src)` | Normalize a raw device to stored form / fill target's blank ids from src |
| `boxFindByIdentifier(value)` | Find which box contains a device with this identifier (any field); move detection. `boxFindBySerial` is a back-compat alias |
| `boxUpsert(boxId, fields)` | Create/merge a box record; stamps audit fields; never overwrites with empty |
| `boxAddDevice(boxId, dev, fields)` | Add/merge a device (dedup+move by shared identifier). `boxAddSerial(boxId,serial,fields)` is a back-compat wrapper |
| `boxSetDevices(boxId, devices, fields, markOpened)` | Replace contents; returns `{missing,extra}` diff by primary id; `markOpened` (default true) sets `opened`. `boxSetSerials` is a back-compat wrapper |
| `boxFinalize(boxId)` / `boxReopen(boxId)` | Capture lifecycle: set `status` `ready` (fast-countable) / `capturing` (re-scan resumes) |
| `boxRecordAudit(boxId, result, counts, location)` | Append a floor-audit record to `box.audit[]` (append-only; result `match`/`diff`/`updated`/`located`); bumps `updatedAt` (v2.33.00) |
| `boxAuditLastLabel(b)` | One-line "last audited" label for the registry list (latest `audit[]` entry; empty if never audited) |
| `boxDelete(boxId)` | Remove a box record |
| `boxSaveToStorage()` / `boxLoadFromStorage()` | Persist/restore `appData.boxes` to/from IDB |

**Capture modal (v2.32.00; symmetric resolution v2.32.01; unknown-device flow v2.32.02)** — build/edit a box's device contents as **registry work, independent of any inventory session (creates no count events)**; counting still happens when the built box is scanned during a session. Flow: scan box ID → tick which columns to record per device (`BOX_CAPTURE_COLUMNS` = serial/fsan/mac; sticky in `_boxCapLastCols`, default serial+fsan) → scan devices. **Symmetric resolution:** scanning ANY identifier into any column resolves the unit and auto-fills the other ticked columns from history, commits the row, and keeps focus on the same column (batch of serials → derive FSANs, and vice-versa). **Unknown-device flow (v2.32.02):** a scan that resolves to nothing is pattern-classified (`boxCapClassify`), RELOCATED into the correct column even if the cursor was elsewhere, and flags the whole entry for verification — amber row + "NEW — verify" badge + a distinct `verify` tone — then keeps the row open (focus walks to the next empty ticked field) instead of auto-committing. Completing the association commits it as `unverified` (amber "NEW" pill on the committed row) AND writes it back to history (`boxCapLearnAssociation`) so it resolves globally next time. A blank required field flags the device `partial`. Auto-filled rows marked ⟲. Opened from the dedicated **Boxes sidebar section** (`#tabBoxes`, `switchTab('boxes')` — the primary front door, works with NO inventory session) or the in-count box-manager modal ("＋ New Box" / per-box "Edit contents ▸"). Global `boxCapState` (+ `entryUnverified`).

| Function | Purpose |
|----------|---------|
| `boxCapOpen(existingBoxId?)` / `boxCapClose()` | Open fresh or for edit (seeds columns from used identifiers) / close |
| `boxCapRenderColumns()` / `boxCapToggleCol(key)` | Column checkboxes (canonical order) / toggle + persist sticky selection |
| `boxCapSetBoxId(input)` | Lock in the scanned box ID (guards duplicate → offers edit) and drop into scanning |
| `boxCapRenderAll()` / `boxCapRenderRows()` / `boxCapRenderEntry()` | Redraw header/committed rows/footer / committed device chips (⟲ = catalog-filled, amber "NEW" = unverified; ✎ edit / ✕ delete) / the live entry inputs + ✓ save button |
| `boxCapCellKey(ev,ci)` | Enter handler: (1) resolve-and-commit fast path, (2) unknown → classify+relocate+flag+keep-open, (3) empty Enter → advance/commit |
| `boxCapNextEmpty(inputs)` / `boxCapSetEntryFlag(on)` | First empty ticked field index (-1 if full) / toggle the amber "NEW — verify" entry look |
| `boxCapSaveRow()` / `boxCapEditRow(idx)` | Commit the current entry on demand ("Save as new / partial") / pull a committed row back into the entry line for correction |
| `boxCapCommitEntry(inputs,focusCol,resolved)` / `boxCapFocusEntry(ci)` | Read entry inputs → set `unverified` + learn if flagged → commit → clear → refresh → focus / focus a cell |
| `boxCapCommitDevice(dev,resolved)` / `boxCapDeleteRow(idx)` | Add/merge a device into the in-modal list (tags `_auto` if resolved, clears `unverified`; else propagates it) / remove a committed row |
| `boxCapPersist()` / `boxCapSaveNew()` / `boxCapSaveDone()` | Write devices to registry + finalize (no count events; pushes history to GitHub once if associations were learned) / save then fresh box (sticky cols) / save then close |

**Box audit — floor verification (v2.33.00).** Deliberate scan-driven loop from the **Boxes tab** (`#boxAuditEntry`), NOT a sticky mode: scan a box → known box opens the audit panel (`#boxAuditModal`), unknown box → build via capture modal. Panel shows registry contents vs physical box, a rescan field + location field, and a live matched/missing/extra diff; commit as Record-audit (stamp only) or Update-to-match (replaces contents). Closing reverts focus to the tab scan field. Local-only → testing-mode-safe. Global `boxAuditState`.

| Function | Purpose |
|----------|---------|
| `boxAuditScan(input)` | Boxes-tab entry: scan a box ID → `boxAuditOpen` if known, else offer `boxAuditBuildNew` |
| `boxAuditBuildNew(id)` | Unknown box → open the capture modal seeded with the scanned ID |
| `boxAuditOpen(boxId)` / `boxAuditClose()` | Open/close the audit panel (close reverts focus to the tab scan field for the next box) |
| `boxAuditScanDevice(input)` | Rescan a physical unit into the audit set (resolve by any id; unresolved = pattern-classified extra); dual-channel feedback (`ok`/`verify`) |
| `boxAuditRemoveScan(idx)` | Drop a mis-scanned unit from the audit set |
| `boxAuditComputeDiff()` | Compare scanned set vs stored contents by shared identifier → `{stored, matched, missing, extra}` |
| `boxAuditRender()` | Render registry contents (✓/✗ once scanning begins), extras, tally; enable Update only when something was scanned |
| `boxAuditRecordOnly()` / `boxAuditApplyUpdate()` / `boxAuditCommit(update)` | Commit: stamp audit only / replace contents to match + stamp; updates `location` if changed |

**Box scan mode (Phase 2)** — a 5th scan mode (`invScanMode === "box"`, mode barcode `##MBOX`). Capture a carton by scanning its ID then its device serials (relies on shipment being imported first, so a scan that doesn't resolve to a known device = a carton ID). Globals: `invActiveBox`, `invLastScannedBox`, `invBoxIsOverride`, `invBoxOverridePrior`.

| Function | Purpose |
|----------|---------|
| `invBoxModeScan(raw, notes)` | Box-mode dispatcher (v2.14.00, armed-state model): if **armed** (New Box tapped) → take scan as carton ID (guards device-as-carton); known device/MAC → capture into active box; known box → resume/fast-count or warn if a *different* box is mid-capture; unrecognized → warn, never invents a box |
| `invBoxResolveDevice(v)` | Resolve a scan to a known device by serial, FSAN, or MAC (shared device lookup) |
| `invBoxNewBox()` | "Save & New": auto-finish (save) the active capture, then arm the next scan as the carton/box ID |
| `invBoxStartCapture(boxId, isOverride)` | Set active capture box (new or resume) |
| `invBoxCaptureDevice(rec, value, notes)` | Count a device + add to active box (dedup-aware) |
| `invBoxFinish()` | "Done/Close box" → `boxFinalize`; for override, diffs vs pre-open snapshot and flags missing/extra |
| `invBoxOpen()` | "Open box" → void this session's sealed-count events for the box, snapshot+clear contents, reopen for override |
| `invBoxVoidSessionCounts(boxId)` | Silently void (no confirm) the box's `box_scan` + `fromSealedBox` events |
| `invBoxSetExpectedQty(v)` / `invBoxClearActive()` / `invBoxRenderBar()` | Optional qty / cancel active capture / refresh the `#invBoxBar` UI (incl. Boxes count + Undo/Done enable) |
| `invBoxUndoLast()` | "Undo last" → void the most recent device scan for the active box and drop its serial from the box contents |
| `invOpenBoxManager()` / `invCloseBoxManager()` | In-count box manager **modal** (opened from the `#invBoxBar` "Boxes" button while counting) |
| `invRenderBoxManager()` / `_boxRenderRegistryInto(list, summary)` | Render the box registry into BOTH the modal (`#invBoxManagerList`) and the dedicated **Boxes section** (`#boxTabList`) — one is on screen at a time, every edit handler re-calls `invRenderBoxManager`, so both stay in sync (v2.32.04) |
| `invBoxManagerToggleContents(key)` / `invBoxManagerDelete(boxId)` | Expand a box's editor / delete a box (voids its current-session counts, clears active if it was the one) |
| `invBoxRename(oldBoxId, btn)` | Rename a box's ID: rekeys the registry, retargets this session's count events' `boxId`, fixes active/last pointers, rejects collisions (finalized history untouched) |
| `invBoxRemoveSerial(boxId, serial)` / `invBoxAddSerialManual(boxId, btn)` | Editor: remove one device (voids its session count event) / add a device (resolves serial-FSAN-MAC, moves from other box, creates a session count event) |
| `invHandleBoxScan(boxId, ctx, notes, loc)` | **Sealed fast-count** (rewritten v2.11.00): count all of a `ready` box's `expectedSerials` in one action; snapshots the list onto the `box_scan` event |

**Open-box gate (v2.17.00)** — a box left `capturing` (interrupted capture; `invActiveBox` is in-memory only while the box record persists) is surfaced in a blocking, no-dismiss modal that must be resolved before scanning resumes. Fires on load + on entering Inventory; scoped to the active session so stale registry boxes don't nag. Re-scanning an already-counted-this-session box now warns instead of silently resuming.

| Function | Purpose |
|----------|---------|
| `invBoxCountedThisSession(boxId)` | True if the box has any non-voided `box_scan`/`serialized_device_scan` event in the current session |
| `invFindOrphanedCapturingBoxes()` | Capturing boxes counted this session that aren't the active capture (the gate's work-list) |
| `invShowOpenBoxGate()` / `invCloseOpenBoxGate()` / `invRenderOpenBoxGate()` | Open/close (disables/re-enables `invScanInput`) / render the gate list with captured serials shown expanded for verification |
| `invGateResumeBox(boxId)` / `invGateCloseBox(boxId)` / `invGateDiscardBox(boxId)` | Per-box actions: resume capture (terminal, drops into box mode) / finalize as-is to `ready` / void session counts + delete record |

### Inventory — Scan Handlers

| Function | Purpose |
|----------|---------|
| `invHandleSerializedScan(value, type, ctx, notes, loc)` | Process serial/FSAN scan → event or exception |
| `invHandleBoxScan(boxId, ctx, notes, loc)` | Sealed fast-count of a known box (see Box Registry section) |
| `invHandleBulkCount(itemNum, qty, notes, loc)` | Record bulk quantity count |
| `invHandleMacScan(mac, ctx, notes, loc)` | Process MAC scan → resolve → serial handler |
| `invHandleReelScan(reelNum, notes, loc)` | Process reel scan → open reel entry panel |
| `invFindSerializedDuplicate(serial, fsan)` | Check if serial/FSAN already in session |
| `invResolveBySerial(key)` | Look up history record by serial |
| `invResolveByFsan(key)` | Look up history record by FSAN |
| `invResolveByMac(mac)` | Look up history record by MAC |
| `invCreateExceptionEvent(value, type, problem, action, notes)` | Create exception event |

---

### Inventory — Reel Entry

| Function | Purpose |
|----------|---------|
| `invOpenReelModal(reelNum, notes, loc)` | Populate and show reel entry panel; reverse-looks up item if blank |
| `invPrefillReelItemNumber(itemNum, notes, loc)` | Pre-fill reel form from item number |
| `invAutoSaveReelInline()` | Silently save current reel before switching to next |
| `invReelUpdateSpanTypeFromContext()` | **Auto-set span type** from history → product map → default; also fills item from reel |
| `invReelSpanTypeChange()` | Show/hide Span B section; recalc footage |
| `invCalcReelFt()` | Calculate footage from inner/outer seq numbers |
| `invReelSwapSpan(span)` | Swap a span's Inner/Outer values (fix a reversed entry); appends to `invReelSwaps` audit trail |
| `invReelRenderSwapNote()` | Render the in-panel swap note from `invReelSwaps` |
| `invReelResetSwaps()` | Clear the swap trail + its UI (note, button highlight) |
| `invReelUpdateHistoryPanel(item, reel, ft)` | Show previous footage comparison |
| `invReelDetectConflict(itemNum, reelNum)` | Detect a reel conflict: `cross_item` (reel on record under a different item) or `session_dup` (already counted this session); null for the normal same-item prefill case |
| `invReelCheckDuplicate()` | Render the live `#invReelDupNote` warning as item/reel fields change — from `invReelDetectConflict`, plus an ambiguous-reel notice (reel on record under multiple items) when item is blank |
| `invFindReelMaster(reelNum)` | **Reverse lookup**: latest event with this reel# across all sessions (used for scan classification) |
| `invReelDistinctItems(reelNum)` | Distinct non-voided item numbers this reel has been recorded under (master + session) — basis for ambiguity detection |
| `invReelReverseFillItem()` | Resolve the item field from the reel master, ambiguity- & staleness-aware: keeps a user-typed item, but re-resolves an auto-filled (grey) item against the **current** reel (single item → fill; ambiguous/unknown → clear) so a previous reel's item can't leak forward |
| `invGetReelHistory(itemNum, reelNum)` | Find most recent event for item+reel pair |
| `invSubmitReelEntry(silent)` | Validate + save reel count event |
| `invClearReelFields()` | Reset all reel form fields |
| `invCloseReelInline()` | Close reel panel |
| `invDiscardReelEntry()` | Discard reel + log exception |

---

### Inventory — Quantity Keypad

| Function | Purpose |
|----------|---------|
| `invShowQtyKeypad(eventId, itemNum, desc)` | Show keypad for bulk count |
| `invShowLockedKeypad()` | Show locked keypad (forced qty=1) |
| `invHideQtyKeypad()` | Reset keypad to idle |
| `invQtyKeyDigit(d)` | Append digit to quantity display |
| `invQtyKeySign()` | Toggle sign |
| `invQtyKeyBackspace()` | Delete last digit |
| `invQtyKeyClear()` | Reset to 1 |
| `invQtyKeySkip()` | Skip item |
| `invQtyKeyApply()` | Apply quantity to event |
| `invKeyFocusField(target)` | Focus specific reel input for keypad entry |
| `invQtyKeypadRefreshReelTarget()` | Highlight active reel field |
| `invQtyRefreshDisplay()` | Update numeric display |

---

### Inventory — Event Editing

| Function | Purpose |
|----------|---------|
| `invVoidEvent(eventId)` | Void event (audit trail preserved) |
| `invUndoVoid(eventId)` | Restore voided event |
| `invOpenNotesModal(eventId)` | Open notes editor |
| `invSaveNotesModal()` | Save notes to event |
| `invCloseNotesModal()` | Close notes modal |
| `invEditRowFieldConfig(eventType)` | Per-`eventType` list of editable fields for the Edit Row modal (`serialized_device_scan`, `bulk_quantity_count`, `exception`); `null` for other types hides the Edit button — reel footage math and box registry integrity are edited via their own dedicated flows instead |
| `invOpenEditRowModal(eventId)` / `invCloseEditRowModal()` | Show/hide the Edit Row modal, rendering inputs from `invEditRowFieldConfig` |
| `invEditRowModalItemChanged()` | Live-refills the Description field from the product map as Item # is typed |
| `invSaveEditRowModal()` | Validate (serial/FSAN required + no clash with another active event; qty ≥ 1) + write all edited fields back onto the event |
| `invToggleFlag(eventId)` | Toggle recount flag on event |

---

### Inventory — Serial Prompt (Unknown Device)

| Function | Purpose |
|----------|---------|
| `invShowSerialPrompt(value, type, loc)` | Show "unknown device" entry dialog |
| `invHideSerialPrompt()` | Close dialog |
| `invCommitSerialPrompt()` | Validate + record manually-entered device; includes an optional Item # field with a "sticky" checkbox that carries the item # forward to the next unknown-device commit (for a run of new serials, e.g. an uncatalogued product line); speaks "Record created" + distinct `manual` tone since this creates a new record rather than confirming an existing one |
| `invCancelSerialPrompt()` | Abandon + log exception |

---

### Inventory — Odoo Data Imports

| Function | Purpose |
|----------|---------|
| `invImportQuantsBaseline(file)` | Load Quants CSV file |
| `invProcessQuantsBaselineCsv(text, fileName)` | Parse Quants CSV → upsert `invQuantsBaseline` |
| `invRenderQuantsBaselineStatus()` | Update Quants status chip in UI |
| `invSaveQuantsBaseline()` | Persist quants to IDB + `appData.odoo_quants` |
| `invLoadQuantsBaseline()` | Restore quants from IDB on startup |
| `invClearQuantsBaseline()` | Clear quants from memory + IDB |
| `invGetQuantId(defCode, locValue, lotName)` | Look up quant record by item+location+lot |
| `invRenderQuantMapStatus()` | Update quant map status chip |
| `invSaveOdooQuantMap()` | Persist quant map to IDB |
| `invLoadOdooQuantMap()` | Restore quant map from IDB |
| `invClearOdooQuantMap()` | Clear quant map |
| `invImportOdooQuantsCsv(file)` | Load Inv Adj Sync CSV file |
| `invProcessOdooQuantCsv(text, fileName)` | Parse Inv Adj Sync CSV → update quant map |
| `invImportLocationMapCsv(file)` | Load Location Map CSV file |
| `invProcessLocationMapCsv(text, fileName)` | Parse Location CSV → build path↔barcode maps |
| `invLocationPathToBarcode(path)` | Convert location path to barcode |
| `invLocationBarcodeToCompleteName(barcode)` | Convert location barcode to display name |
| `invRenderLocationMapStatus()` | Update Location Map status chip |
| `invSaveLocationMap()` | Persist location maps to IDB |
| `invLoadLocationMap()` | Restore location maps from IDB |
| `invClearLocationMap()` | Clear location maps |

---

### Inventory — Gap Analysis / Variance Report

| Function | Purpose |
|----------|---------|
| `invActiveEventCount()` | Count of non-voided, non-`void_event` events — same filter `invBuildGapReport()` reads; used to detect a stale Gap Analysis run |
| `invRunGapAnalysis()` | Entry point — validates prerequisites + calls build; records `invGapAnalysisLastRunSessionId`/`invGapAnalysisLastRunEventCount` so `invClearSession()` can warn if the loaded session hasn't been analyzed yet, or was analyzed before events were later added |
| `invBuildGapReport()` | **Core**: compare active session events vs `invQuantsBaseline`; returns `{ serialized, bulk, reels }` |
| `invRenderGapReport(report)` | Render gap report card with collapsible sections + summary chips |

---

### Inventory — Legacy Recount (Session-Level) — UNREACHABLE, superseded

> These functions manage recount workflows *within* an active inventory session — superseded by the **Recount Manager** section below (movement records, resolution status, NISC qty, chain-history XLSX). As of v2.29.15 the sidebar button that launched this (`invStartRecount`) was repointed to `invGoToRecountManager()` instead, so nothing in the UI reaches this code anymore. Kept for now rather than deleted outright — see FEATURES.md for the removal decision.

| Function | Purpose |
|----------|---------|
| `invStartRecount()` | *(unreachable)* Start recount workflow from closed session |
| `invBuildRecountFromParent()` | Populate recount list from parent session |
| `invAddToRecountList()` | Manually add item to recount |
| `renderRecountQueue()` | Render recount queue + progress |
| `invRecountBeginWalkthrough()` | Start guided walkthrough |
| `invRecountEndWalkthrough()` | End walkthrough |
| `invRecountShowCurrent()` | Display current recount item |
| `invRecountSaveItem()` | Record recount count |
| `invRecountSkipItem()` | Skip current item |

---

### Reel Lookup (Products tab)

> Read-only browse of last-known reel footage, in the Products tab — no inventory session required. Sources reel data straight from `cable_reel_count` events (master + active session), deduped to the latest non-voided event per item+reel. Searchable by item number or reel number; grouped by item; item links open `prodShowItemHistory`.

| Function / Variable | Purpose |
|---------------------|---------|
| `_REEL_LOOKUP_CAP` | Max reel rows rendered before a "narrow your search" note (500) |
| `reelLookupBuildList()` | Aggregate non-voided `cable_reel_count` events → latest per item+reel |
| `reelLookupRender()` | Render the Reel Lookup card: filter by `#reelLookupSearch`, group by item, table per reel |

---

### Inventory — CSV Import (Reels)

| Function | Purpose |
|----------|---------|
| `invImportReelsCsv(inputEl)` | Load reel CSV file; detects columns by header name (any order), else legacy positional; runs within-file dup detection |
| `_parseReelCsv(text)` | Parse CSV text → row arrays |
| `_REEL_CSV_LEGACY` / `_REEL_CSV_FIELDS` | Legacy positional column order / accepted header-name synonyms per field |
| `_reelCsvDetectCols(headerRow)` | Build `{field → colIndex}` from a header row by name; null if unrecognizable |
| `_reelCsvParseDate(raw)` | Parse reel CSV date (ISO `YYYY-MM-DD HH:MM` **and** US `M/D/YYYY H:MM`); null if unparseable |
| `_analyzeReelCsvRows(rows, colMap)` | Determine action per row (add / update / skip / skip_active); reads via `colMap`; tags each row with `reelKey`/`rawCols`/`dataRowIndex` |
| `_reelCsvImportMeta` / `_REEL_CSV_DUP_LIMIT` | Import session meta `{header,dataRows,colMap,dupSets,picks}` / max dup reels before report-only (10) |
| `_reelCsvDuplicateSets(parsed)` | Group parsed rows by reel number; return sets with >1 row (within-file duplicates) |
| `_reelCsvDefaultWinnerIdx(rows)` | Default winner of a dup set = most recent dated row, else last occurrence |
| `_reelCsvSurviving(parsed, meta)` | Parsed rows minus dup-set losers per the user's picks |
| `_showCsvImportModal(parsed)` | Preview modal; branches to dup-resolve (1–10) or dup-report (>10) when duplicates exist |
| `_showCsvDupResolveModal(parsed, dupSets)` / `_showCsvDupReportModal(dupSets)` | Resolve modal (pick winner per reel) / report-only modal (bad data) |
| `invCsvResolvePick(reelKey, occIdx)` | Pick which row wins a duplicate set; re-renders the resolve modal |
| `invCsvDownloadCorrectedSource()` | Re-emit the original file minus dropped duplicate rows (faithful, source format) |
| `invCsvDownloadDupReport()` | Download duplicate report (grouped by reel, one row per occurrence) |
| `invConfirmCsvImport()` | Execute import: drop dup losers, create events + export master |
| `invCancelCsvImport()` | Close modal; clear import meta |

---

### Inventory — Exports

| Function | Purpose |
|----------|---------|
| `exportInvEventLogCsv()` | Export event log to CSV |
| `exportInvSummaryCsv()` | Export summary to CSV |
| `exportInvEventLogXlsx()` | Export event log to XLSX |
| `exportInvSummaryXlsx()` | Export summary to XLSX |
| `exportRecountXlsx()` | Export recount results to XLSX |
| `invMakeXlsx(headers, rows, sheet)` | Build XLSX workbook |
| `buildEventLogBaseRow(e)` | Build common CSV/XLSX fields for an event |
| `buildInvSummaryMap(events)` | Aggregate events by item |
| `buildExportPayload()` | Build full master JSON payload (10yr purge); includes `odoo_quants`, `recount_sessions`, `recount_movements` |
| `requireInvSession()` | Guard: alert if no active session |

---

### Recount Manager

> Post-submission recount workflow. Manages sessions, physical recount workflows, movement records, resolution status, and XLSX output. Data persisted in `RC_STORAGE_KEY` and mirrored into `appData`.

#### Storage & Init

| Function | Purpose |
|----------|---------|
| `rcLoadStorage()` | Restore `rcSessions` + `rcMovements` from IDB on startup |
| `rcSaveStorage()` | Persist to IDB + sync into `appData` |
| `rcLoadFromAppData()` | Load from `appData` after master JSON import |
| `rcGenSessionId()` | Generate `rc_YYYYMMDDHHNN_xxx` ID |
| `rcGenItemId()` | Generate `rci_...` item ID |

#### Session Management

| Function | Purpose |
|----------|---------|
| `rcOpenCreateFromGaps()` | Pre-populate create form from current gap report |
| `rcShowCreate(fromGaps)` | Show create session form |
| `rcCancelCreate()` | Cancel create form |
| `rcConfirmCreate()` | Build + save new recount session; switch to detail view |
| `rcShowList()` | Switch to session list view |
| `rcShowDetail(recountId)` | Switch to session detail view |
| `rcAddManualItem()` | Manually add item to session discrepancy list |
| `rcDeleteItem(recountId, rcItemId, type)` | Remove item from session |
| `rcSetNiscQty(recountId, rcItemId, type, val)` | Set NISC expected quantity on an item |

#### UI Rendering

| Function | Purpose |
|----------|---------|
| `rcRenderCard()` | Top-level render — switches list/create/detail view |
| `rcRenderList()` | Render session list |
| `rcRenderDetail()` | Render session detail with all three item type sections |
| `rcRenderDiscrepancySection(session, type)` | Render serialized / bulk / reels discrepancy table |

#### Physical Recount Workflows

| Function | Purpose |
|----------|---------|
| `rcOpenWorkflow(recountId, rcItemId, type)` | Open workflow modal for an item |
| `rcCloseWorkflow()` | Close workflow modal; null `rcWfState` |
| `rcWfBuildSerialBody(item)` | Build serialized scan UI (accumulator + list) |
| `rcWfBuildBulkBody(item)` | Build bulk qty entry UI |
| `rcWfBuildReelBody(item)` | Build reel inner/outer entry UI |
| `rcWfScanKeydown(e)` | Handle Enter key in serial scan field |
| `rcWfScanAdd()` | Add scanned serial to accumulator (dedup alert) |
| `rcWfRemoveSerial(idx)` | Remove serial from accumulator |
| `rcWfRefreshSerialList()` | Re-render serial accumulator list |
| `rcWfCalcFt()` | Calculate footage from inner/outer sequences |
| `rcWorkflowConfirm()` | Validate + save workflow result; set item status `"complete"` |

#### Movement Records

| Function | Purpose |
|----------|---------|
| `rcOpenMovementPanel(recountId, rcItemId, type)` | Open movement panel for an item |
| `rcCloseMovementPanel()` | Close panel + re-render detail |
| `rcRenderMovementPanel()` | Render full movement panel (attached + existing + create form) |
| `rcRenderMovementCard(m, canDetach)` | Render single movement record card |
| `rcMvCreateAndAttach()` | Validate + create new movement record + attach to item |
| `rcMvAttachExisting()` | Attach existing global movement to current item |
| `rcMvDetach(movementId)` | Detach movement from item |
| `rcGenMovementId()` | Generate `mv_...` movement ID |
| `rcResolutionSelect(recountId, rcItemId, type, val)` | Build resolution status `<select>` HTML |
| `rcSetResolution(recountId, rcItemId, type, val)` | Save resolution status on item |

#### XLSX Export

| Function | Purpose |
|----------|---------|
| `rcExportXlsx(recountId)` | Export three-tab XLSX (Serialized / Bulk / Reels) with chain history |
| `rcBuildChain(session)` | Walk `parentId` chain back through recount + inventory sessions |
| `rcChainHistoryForItem(chain, item, type)` | Per-session history lookup for chain columns |
| `rcMovementsSummary(item)` | Format movements as multi-line summary string |
| `rcResolutionLabel(val)` | Convert snake_case resolution key → readable label |
| `rcAutoColWidths(headers, rows)` | Auto-size XLSX columns (max 60 chars) |

#### Recount Worklist (v2.30)

> Location-ordered, movement-adjusted worktable. Ingests 3 external files, joins them per item (port of `docs/recount_reference.js`), and drives shelf-order recounts inside a **worklist-flavored recount session** (`session.worklist = true`). Reuses rcItems / recountedQty / movements / resolution / persistence / merge. Import via CSV Column Mapper types `recount_count` / `recount_movement` / `recount_nisc` **or** universal-drop auto-detect. Source files are global + newest-wins in `ghMergeMasters` (like `odoo_quants`).

| Function | Purpose |
|----------|---------|
| `rcProcessCountCsv(text, name)` | Parse physical count (Item, QuantitySum, Ticket, COUNT DATE, LINE); fail-loud on missing headers; blank-LINE = recount |
| `rcProcessMovementCsv(text, name)` | Parse Odoo moves; direction via `rcMovementDir` (Reference prefix); item from `[item]` in Product |
| `rcProcessNiscCsv(text, name)` | Parse NISC capture (Captured Qty = expected, Current Count Qty = NISC's count); **upsert by item**; `Serial/Reel`→classification |
| `rcImportCountCsv/MovementCsv/NiscCsv(file, cb)` | File-reader wrappers for the universal drop router |
| `rcLoadWorklistData()` | Restore the 3 source files from IDB on startup |
| `rcClearCountData/MoveData/NiscData()` | Clear a source file (confirm + IDB remove) |
| `rcBuildWorklist(focusSet, extraRows, locRecounts)` | **Core join engine**: countByItem + moveByItem (per-item since-count gating) → `{ flat[], absent[], niscDrops[] }`; outbound auto-subtracted, inbound flagged. `extraRows` = session `addedCountRows` (walk-time found-at rows) folded into totals + flagged `added`. `locRecounts` = `{ITEM\|\|LOC:qty}` per-location walk counts that override that shelf's file qty → Item Total + Short self-correct |
| `rcWlSetLocRecount(id,itemUp,loc,val)` | Per-location recount box (every shelf row): store/clear `session.locRecounts[item\|\|loc]`; sets item status |
| `rcWlOpenAddRow / rcWlCloseAddRow / rcWlCommitAddRow(id,itemUp) / rcWlRemoveAddedRow(id,idx)` | "＋loc" add-a-found-location flow: modal → append to `session.addedCountRows` (isRecount, dated today) → Short self-corrects; undo via removal |
| `rcSessionFocusSet(session)` / `rcFindItemByNumber(session, up)` | Session helpers: item-number set / lookup |
| `rcShowWorklistHome()` / `rcOpenWorklist(id)` | Enter worklist home (build form + data status) / open a saved worklist |
| `rcConfirmWorklistCreate()` | Build session from pasted list (or all counted items); classify items via NISC; seed niscExpectedQty from Captured |
| `rcWlSetSort(v)` / `rcWlSetIsolate(v)` | Location/item sort toggle / single-item isolate filter |
| `rcWlSetRecount(id, itemUp, val)` | Save recount qty onto the item's `recountedQty` + status |
| `rcRenderWorklist()` / `rcRenderWorklistHome()` / `rcRenderWorklistTable(session)` | View dispatch / build-home / worktable + absent + niscDrops |
| `rcDataStatusRow()` / `rcClsBadge()` | Render helpers |
| `rcExportWorklistCsv(id)` | Download location-ordered CSV (mirrors `recount_worksheet_FOCUSED_by_location.csv`) |
| `rcNum / rcCountDay / rcMoveDay / rcDayToDisplay / rcMovementDir / rcColIdx` | Parse helpers (comma-number strip, date→int, direction, header lookup) |

---

### Products / Catalog

| Function | Purpose |
|----------|---------|
| `prodRenderList()` | Render product table with search filter |
| `buildCatalogRowCells(key, map)` | Build HTML cells for one product row |
| `prodRenderOneRow(key)` | Re-render single row in place |
| `prodEditProduct(key)` | Open product edit modal |
| `prodEditTrackingChanged()` | Update form when tracking type changes |
| `prodSaveEdit()` | Save product edits to `PRODUCT_MAP` |
| `prodCancelEdit()` | Close edit modal |
| `prodShowSaveToast(msg)` | Temporary save confirmation |
| `prodShowItemHistory(itemNum)` | Show receiving + inventory history modal |
| `prodCloseHistoryModal()` | Close history modal |
| `prodDownloadTemplate()` | Download bulk-upload CSV template |
| `prodBulkUpload(file)` | Process bulk product upload |
| `prodShowUploadDiff(diff)` | Show upload diff preview |
| `prodApplyUpload()` | Apply upload changes |
| `prodCancelUpload()` | Cancel upload |
| `prodToggleNotes()` | Toggle help text panel |

---

### Catalog Health (`chk*`)

> Products-tab job that dedupes vendor-PN aliases and surfaces orphans / incomplete catalog entries. Report-first; merges are confirmed per group and **non-lossy** — folded vendor part numbers are preserved in `entry.aliases[]` and resolved by `findProductMapMatch` (`matchedBy: "alias"`). Alias groups are keyed on shared `odoo_external_id` (same Odoo product); same-`hctc`-but-different-Odoo-ID cases are flagged as **conflicts**, never auto-merged. Ignored groups persist in `tim_catalog_health_v1`.

| Function / Variable | Purpose |
|---------------------|---------|
| `CHK_STATE_KEY` / `chkIgnored` / `chkCanonicalChoice` / `chkLastReport` | TimDB key + state — grep `var CHK_STATE_KEY` |
| `chkLoadState()` / `chkSaveState()` | Restore / persist dismissed alias groups |
| `chkBuildReport()` | **Core analysis** → `{ aliasGroups, conflicts, danglingBarcodes, danglingHistory, deadRows, incomplete, ignoredCount, totalProducts }` |
| `chkRunHealthCheck()` | Build + render report into the Products-tab card |
| `chkRenderReport(r)` | Render summary chips + all sections |
| `chkRenderCapped(arr, cap, fmt, sink)` | Render up to `cap` rows; appends honest "+N more" note |
| `chkPickCanonical(sig, members)` | Default canonical = NISC-native row (key === hctc), else most complete |
| `chkCompleteness(e)` / `chkExtId(e)` / `chkJsStr(s)` | Scoring / ext-ID normalize / onclick-string escape helpers |
| `chkSetCanonical(sig, key)` | Override which member survives a merge |
| `chkMergeAliasGroup(sig)` | **Non-lossy merge** — fold aliases into canonical, preserve in `aliases[]`, save, re-run (confirmed) |
| `chkIgnoreGroup(sig)` / `chkClearIgnored()` | Dismiss a group / un-ignore all |

---

### NISC Catalog + Dedup/Numbering (`pn*` / `cat*` / `num*` / `ni*`)

Ports the NISC catalog dedup + product-numbering process into TIM (Phase 1 = ingest + new-item intake). Report-first, non-lossy, fully offline. `_CSV_IMPORT_TYPES` entry `nisc_catalog` ("NISC Full Item Export") routes to `catImportNiscExport`.

| Function | Purpose |
|----------|---------|
| `pnMineTokens(text)` | General part-number miner → `{token: score(3\|4\|5)}` (port of `Get-PartTokens`) |
| `pnExplicit(text)` | Labelled `PART#/PN#/P/N/MODEL#` PNs → `{token: 6}` (port of `Get-ExplicitPNs`) |
| `pnNorm(t)` | Separator-insensitive canonical PN form (strip non-alnum, upper) |
| `pnLevRatio(a,b)` | Levenshtein ratio, rounded 3 decimals |
| `pnNameTokens(text)` | Name → Set of tokens (len≥2, minus stopwords) |
| `pnDice(a,b)` | Sørensen–Dice over two Sets, rounded 3 decimals |
| `catDeriveClass(group,item)` | Derive Inventory/Exempt/Non-inventory (group map + number-format overrides: 18-block=Exempt, alphanumeric never Inventory except DROP) |
| `catImportNiscExport(text,name)` | Parse Full Item Export → `appData.nisc_catalog`, persist, rebuild PN index |
| `catSaveState()` / `catLoadState()` | Persist / restore catalog layer (TimDB `tim_nisc_catalog_v1`) |
| `catBuildPnIndex()` | Build in-memory `{normPN:{part_number,items[]}}` index (reproduces `partnumber_index.json`) |
| `numLoadDb()` | Seed numbering legend from bundled `numbering_db.json` (TimDB `tim_numbering_db_v1`) |
| `numOccupancy()` | Live AABBCC base occupancy from all known item numbers |
| `numLiveNext(base)` | Next iteration = max(used ∪ legend) + 1 (never gap-fill) |
| `numSuggest(cls,group)` | Class-aware suggestion (Inventory → generic max+1; Exempt/Non-inv → scheme) |
| `niUpdateStatus()` | Update the New Item card's catalog-loaded status chip |
| `niCheckItem()` | New-item dup-check: exact/fuzzy PN + name-sim (port of `check_new_item.ps1`); warns on strong match, else suggests a number |
| `niRenderResults(r)` / `niRowsHtml(list)` | Render dup-check results + numbering suggestion into `#niResults` |
| `niSearchBases()` | Search scheme bases by category/desc/example; show base + live suggested `base-N` |

---

### Barcode Assignment

| Function | Purpose |
|----------|---------|
| `bcProcessBarcodeScan()` | Process barcode scan input |
| `bcProcessItemNumber()` | Link scanned barcode to item number |
| `bcAddToBatch(barcode, item, desc, known)` | Add/update barcode in batch |
| `bcIncludeKnown(idx)` | Mark known barcode for inclusion |
| `bcRemoveFromBatch(idx)` | Remove from batch |
| `bcRenderBatch()` | Render barcode batch table |
| `bcClearBatch()` | Clear all barcode batch entries |
| `bcExportAndSave()` | Export to Odoo CSV + save to `BARCODE_MAP` |
| `bcImportOdooCsv(file)` | Import Odoo barcode CSV |
| `bcProcessOdooImport(text, fileName)` | Parse + merge Odoo barcode CSV |
| `bcLoadBarcodeMap()` | Restore barcode map from IDB |
| `bcSaveBarcodeMapToStorage()` | Persist barcode map to IDB |
| `bcSaveBatchDraft()` | Save barcode batch to IDB |
| `bcLoadBatchDraft()` | Restore barcode batch from IDB |
| `bcShowFeedback(type, msg)` | Show scan feedback |
| `bcCancelUnknown()` | Cancel unknown barcode linking |
| `bcParseCsvRow(line)` | Parse quoted CSV row |

---

### UI / Navigation

| Function | Purpose |
|----------|---------|
| `switchTab(name)` | Switch main tab; persists to localStorage; shows Inventory sub-nav + applies sub-view |
| `invShowSubview(name)` | Switch Inventory sub-screen (count/exceptions/summary/gap/recount/eventlog) by toggling `[data-inv-subview]` cards; Count is a static no-scroll frame |
| `toggleSidebar()` | Collapse/expand left sidebar |
| `updateSidebarStatus(step, rows)` | Update sidebar file-loaded indicators |
| `toggleMoreDropdown(e)` | Toggle "More" menu |
| `toggleCollapsible(bodyId, headerId, chevronId)` | Expand/collapse card |
| `setDropState(dropId, statusId, loaded, msg)` | Update drop zone loaded state |
| `updateClearBtns()` | Show/hide clear buttons based on data presence |
| `prefillMapping(product, desc)` | Pre-fill product mapping form |
| `timInitUsername()` | Load + display stored username |
| `timGetUsername()` | Read username from localStorage |
| `timSetUsername(val)` | Save username to localStorage |
| `checkForUpdate()` | Check GitHub Pages for newer version |

---

### Location (Inventory)

| Function | Purpose |
|----------|---------|
| `invToggleLocPopover(e)` | Toggle location picker |
| `invLocPopoverSet()` | Set location from popover |
| `invCloseLocPopover()` | Close location popover |
| `invClearLocation()` | Clear current location |

---

### Audio

Scan feedback is **mandatory + dual-channel** (tone + full-screen flash). Tones are pre-rendered to WAV data-URIs and played via HTMLAudio elements (survives iOS silent mode, unlike Web Audio oscillators); the oscillator path remains as a fallback. No in-app mute — only the tablet's volume/mute controls it.

| Function | Purpose |
|----------|---------|
| `_timTonePatterns` | Tone designs (success family / `warn` / `error`) as `{f,t,d,v,shape}` lists |
| `_timToneToWav(pattern)` | Synthesize a pattern → 16-bit mono WAV data-URI |
| `timInitAudio()` | Render all tones to preloaded `<audio>` elements (once) |
| `_timAudioCtx_get()` | Get/create AudioContext (fallback synth path only) |
| `timAudioPrime()` / `timUnlockAudio()` | Unlock media playback within a gesture; resume ctx (alias) |
| `_timOscFallback(type)` | Live-oscillator synth, used when `<audio>` play() is rejected |
| `timPlayTone(type)` / `timBeep(type)` | Play a tone by name (audio only); tracks blocked state |
| `timFlash(severity)` | Full-screen flash overlay: `ok` (subtle green) / `warn` (amber) / `error` (loud red strobe) |
| `timFeedback(type, toneVariant)` | **Unified entry**: drives tone + flash; severity from `type`, success tone from `toneVariant` |
| `timUpdateAudioStatus()` / `timTestSound()` | Audio status chip / "Test sound" button handler |
| `playBeep(type)` | Receiving/blind-scan feedback → routes to `timFeedback` |
| `invSpeak(text)` | Optional spoken feedback (Web Speech); speaks SIGNIFICANT events only, cancels in-flight phrase; no-op unless enabled. Rapid device scans stay tone-only |
| `timVoiceSetEnabled(on)` / `timVoiceLoadPref()` | Toggle handler / load persisted `tim_voice_enabled` pref |
| `timVoicePrime()` | Warm speechSynthesis inside a user gesture (iOS first-utterance unlock) |
| `timVoiceUpdateStatus()` / `timTestVoice()` / `timInitVoice()` | Voice toggle+chip sync / "Test voice" button / startup init |

---

### Clear / Reset Operations

| Function | Purpose |
|----------|---------|
| `clearAllData()` | Wipe everything (products, history, batch, barcodes) |
| `clearMasterData()` | Clear products + history + barcodes only |
| `clearSourceData()` | Clear source file + batch only |
| `clearProductCatalog()` | Clear product map only |
| `clearBarcodeImport()` | Clear barcode map only |

---

## Service Worker (`sw.js`)

| Event | Strategy | Notes |
|-------|----------|-------|
| `install` | Precache CDN + local files | Calls `skipWaiting()` — activates immediately |
| `activate` | Delete old caches | `clients.claim()` — takes over existing pages |
| `fetch` | Skip non-HTTP requests (chrome-extension guard) | CDN → cache-first; local → network-first with cache fallback |

**Precached:** `xlsx@0.18.5`, `JsBarcode@3.11.6`, `manifest.json`, `styles.css`, `app.js`

**To deploy an update:** bump `CACHE` version → old cache evicted on next activate.
