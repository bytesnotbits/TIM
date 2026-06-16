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
| `tim_gh_config_v1` | GitHub sync config `{ owner, repo, branch, autoLoad }` |
| `tim_gh_token_v1` | GitHub fine-grained PAT (Contents: read on the data repo) |
| `tim_gh_shas_v1` | Per-file blob SHAs from last GitHub sync (for Phase 2 write-back) |
| `tim_catalog_health_v1` | Catalog Health review state `{ ignored: { extId → true } }` (dismissed alias groups) |

`localStorage` stores only UI state: `tim_active_tab`, `tim_sidebar_collapsed`, `tim_username`.

---

## Key Global Variables

| Variable | Purpose |
|----------|---------|
| `APP_VERSION` | Version string shown in UI |
| `appData` | Root container: `{ product_map, history, inventory_sessions, inventory_events, barcode_map, odoo_quants, recount_sessions, recount_movements }` |
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
| `timLoadMasterCache()` | Load product_map + history from IDB on startup |
| `timSaveMasterCache()` | Persist product_map + history to IDB |
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
| `ghUnresolvedConflictCount()` | Count of `status !== "resolved"` entries (for the status line / badge) |
| `ghMergeConflictEntries(incoming)` | Fold new/pulled conflict entries into the log, deduped by `conflictId` (resolved wins) |
| `ghConfig` / `ghToken` | In-memory settings `{ owner, repo, branch, autoLoad, deviceLabel }` + PAT |
| `ghConfigured()` | True when token + owner + repo are set |
| `ghSetStatus(msg, state)` | Update sync status line on the Data Import card |
| `ghMarkPendingPush()` / `ghClearPendingPush()` | Set/clear the deferred-push flag (local has/has-not changes not yet on GitHub) |
| `ghBindOnlineRetry()` | Bind a one-time `online` listener that flushes a pending push on reconnect |
| `ghHeaders(accept)` | Build auth headers for the GitHub API |
| `ghFetch(url, options)` | `fetch` wrapper with AbortController timeout + 1 retry; normalizes timeout→TypeError so callers defer & retry. All GitHub fetches route through this so a hung connection can't stick `ghSyncInFlight` |
| `ghApi(path, accept, tokenOverride)` | api.github.com GET via `ghFetch` (no-store) |
| `ghLoadSettings()` | Restore config + token from IDB on startup |
| `ghOpenConfig()` / `ghCloseConfig()` | Show/hide the config modal |
| `ghTestConnection()` | GET `/repos/{o}/{r}` with form values; report ok/401/404 |
| `ghSaveConfig()` | Persist settings + token, then sync |
| `ghClearConfig()` | Remove token/config/SHAs from this device |
| `ghListDataDir(allowMissing)` | List `data/` folder contents (names + blob SHAs); `allowMissing` returns `[]` on 404 |
| `ghFetchJsonFile(path)` | Fetch one file as raw JSON (`vnd.github.raw+json`) |
| `ghSyncNow(silent)` | **Main pull = 3-way merge** (v2.06.00): list → fetch all → assemble remote → `ghMergeMasters(base, local, remote)` → `loadSourceData(merged)` → log conflicts + pull repo `conflicts.json` → save base(=remote) & SHAs → mark pending if merged has local-only changes. Atomic; no longer clobbers local. |
| `_ghAssembleRemote(fetched)` | Assemble fetched repo files → `{ payload, conflicts, hadHistoryShards }` (shared by pull + push-rebase) |
| `_ghPayloadDiffers(a,b)` | Cheap per-collection deep-compare; true if merged has changes not yet in the repo |
| `ghInit()` | Startup hook: load settings; if a push is pending, PUSH (not pull, which would clobber the offline edit), else auto-sync if `autoLoad`. Runs after `timLoadMasterCache()` resolves |
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
| `ghRenderConflictsList()` | Render the conflict rows (unresolved first) + footer |
| `ghApplyResolution(entry, chosen)` | Write the chosen value back into the in-memory master (by collection/key/field; null = delete) |
| `ghChooseCandidate(conflictId, idx)` | Resolve one conflict: apply + mark resolved + save + pending + re-render; auto-push when all resolved |
| `ghPushResolved()` | "Push resolved now" — publish resolved changes while others remain |

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
| `invClearSession()` | Clear session from memory + IDB |
| `invFinalizeSession()` | Close session + merge events into master data |
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
| `renderInvSidebarSession()` | Update sidebar session indicator + stats |
| `renderInvStatusBar()` | Update mode pill, location, event count |
| `renderInvEventLog()` | Render event log table (filterable) |
| `renderInvSummary()` | Render per-item summary (qty, footage) |
| `renderInvExceptions()` | Render exceptions panel |
| `renderInvActivityFeed()` | Render activity feed |
| `invAddActivity(type, msg, detail)` | Append to activity feed + beep |
| `invClearActivityFeed()` | Clear activity feed |
| `invSetScanFeedback(msg, type, detail)` | Show scan result message + log to activity |

---

### Inventory — Scanning Core

| Function | Purpose |
|----------|---------|
| `invProcessScan()` | **Main scan entry point** — reads input, routes to handler |
| `invClassifyScan(raw)` | Detect scan type: `fsan \| box_id \| location \| reel_number \| serial \| item_number \| barcode \| mac \| unknown` |
| `invUpdateDetectedBadge(raw)` | Update scan-type badge in UI |
| `invGetScanMeta(type, value)` | Resolve item/description metadata for scan value |
| `invShowScanMeta(meta)` | Display metadata badge below scan field |
| `invHideScanMeta()` | Hide metadata badge |
| `invClearScanInput()` | Clear scan field + feedback |
| `invSetScanMode(mode)` | Switch `invScanMode`; updates UI + keypad |
| `invSetLocation(loc)` | Set/clear sticky location |

---

### Inventory — Scan Handlers

| Function | Purpose |
|----------|---------|
| `invHandleSerializedScan(value, type, ctx, notes, loc)` | Process serial/FSAN scan → event or exception |
| `invHandleBoxScan(boxId, ctx, notes, loc)` | Process box scan → count devices inside |
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
| `invReelUpdateHistoryPanel(item, reel, ft)` | Show previous footage comparison |
| `invFindReelMaster(reelNum)` | **Reverse lookup**: find any event with this reel# across all sessions |
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
| `invEditEventQty(eventId)` | Edit bulk event quantity inline |
| `invToggleFlag(eventId)` | Toggle recount flag on event |

---

### Inventory — Serial Prompt (Unknown Device)

| Function | Purpose |
|----------|---------|
| `invShowSerialPrompt(value, type, loc)` | Show "unknown device" entry dialog |
| `invHideSerialPrompt()` | Close dialog |
| `invCommitSerialPrompt()` | Validate + record manually-entered device |
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
| `invRunGapAnalysis()` | Entry point — validates prerequisites + calls build |
| `invBuildGapReport()` | **Core**: compare active session events vs `invQuantsBaseline`; returns `{ serialized, bulk, reels }` |
| `invRenderGapReport(report)` | Render gap report card with collapsible sections + summary chips |

---

### Inventory — Legacy Recount (Session-Level)

> These functions manage recount workflows *within* an active inventory session. For the post-submission Recount Manager, see the **Recount Manager** section below.

| Function | Purpose |
|----------|---------|
| `invStartRecount()` | Start recount workflow from closed session |
| `invBuildRecountFromParent()` | Populate recount list from parent session |
| `invAddToRecountList()` | Manually add item to recount |
| `renderRecountQueue()` | Render recount queue + progress |
| `invRecountBeginWalkthrough()` | Start guided walkthrough |
| `invRecountEndWalkthrough()` | End walkthrough |
| `invRecountShowCurrent()` | Display current recount item |
| `invRecountSaveItem()` | Record recount count |
| `invRecountSkipItem()` | Skip current item |

---

### Inventory — CSV Import (Reels)

| Function | Purpose |
|----------|---------|
| `invImportReelsCsv(inputEl)` | Load reel CSV file |
| `_parseReelCsv(text)` | Parse CSV text → row arrays |
| `_analyzeReelCsvRows(rows)` | Determine action per row: add / update / skip / skip_active |
| `_showCsvImportModal(parsed)` | Show preview modal with counts |
| `invConfirmCsvImport()` | Execute import: create events + export master |
| `invCancelCsvImport()` | Close modal |

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
| `prodExportMasterJson()` | Download current master JSON |
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
| `switchTab(name)` | Switch main tab; persists to localStorage |
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

| Function | Purpose |
|----------|---------|
| `_timAudioCtx_get()` | Get/create AudioContext (inventory mode) |
| `timUnlockAudio()` | Resume suspended AudioContext on user gesture |
| `timBeep(type)` | Beep: `"ok" \| "warn" \| "error"` (inventory) |
| `getAudioCtx()` | Get/create AudioContext (receiving mode) |
| `playBeep(type)` | Beep: `"ok" \| "error"` (receiving mode) |

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
