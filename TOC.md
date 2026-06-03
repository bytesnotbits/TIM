# TIM — Codebase Table of Contents

> Purpose: quick-lookup reference to reduce research time. Line numbers are in `app.js` unless noted.

---

## Architecture Overview

Single-page PWA. Four files do all the work:

| File | Role |
|------|------|
| `index.html` | All HTML markup; inline `oninput`/`onclick` handlers wire to `app.js` functions |
| `app.js` | All application logic (~8100 lines); no framework |
| `styles.css` | All styling |
| `sw.js` | Service worker: network-first for local files, cache-first for CDN; cache key `tim-v4` |

### Main Tabs / Feature Areas
- **Receiving** — load Calix/RMA source file, map products, export to Odoo
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

`localStorage` stores only UI state: `tim_active_tab`, `tim_sidebar_collapsed`, `tim_username`.

---

## Key Global Variables

| Variable | Line | Purpose |
|----------|------|---------|
| `APP_VERSION` | 2 | Version string shown in UI |
| `appData` | 11 | Root container: `{ product_map, history, inventory_sessions, inventory_events, barcode_map, odoo_quants, recount_sessions, recount_movements }` |
| `PRODUCT_MAP` | 12 | Alias for `appData.product_map` — item definitions keyed by item number |
| `BARCODE_MAP` | 13 | Alias for `appData.barcode_map` — barcode→item lookup |
| `currentBatch` | 15 | Rows being processed in current receiving batch |
| `blindQueue` | 19 | Devices queued for blind receiving |
| `invSession` | 1648 | Active inventory session object (null if none) |
| `invEvents` | 1649 | Events in active session (current scan session only) |
| `invExceptions` | 1650 | Exception events in active session |
| `invSequence` | 1653 | Monotonic event sequence counter |
| `invScanMode` | 1659 | `"auto" \| "serial" \| "reel" \| "item"` |
| `invCurrentLocation` | 1657 | Sticky scan location |
| `_invAutoRestoreStarted` | 1657 | Flag preventing hint/restore race on load |
| `INV_STORAGE_KEY` | 1557 | `"calix_inv_session_v1"` |
| `INV_QUANTS_BASELINE_KEY` | 5009 | `"tim_odoo_quants_baseline_v1"` |
| `INV_LOCATION_MAP_KEY` | 4880 | `"tim_location_map_v1"` |
| `INV_LOCATION_BARCODE_MAP_KEY` | 4908 | `"tim_location_barcode_map_v1"` |
| `invQuantsBaseline` | ~5010 | Array of quant rows loaded from Odoo export |
| `invLocationMap` | ~4881 | Path→barcode lookup built from location CSV |
| `invLocationBarcodeMap` | ~4882 | Barcode→complete name reverse lookup |
| `RC_STORAGE_KEY` | 5975 | `"tim_recount_v1"` |
| `rcSessions` | 5977 | Array of recount session objects |
| `rcMovements` | 5978 | Array of recount movement records |
| `rcView` | 5979 | `"list" \| "create" \| "detail"` |
| `rcActiveId` | 5980 | recountId of session shown in detail view |
| `rcCreateGapItems` | 5981 | Pre-populated items from a gap report |
| `rcWfState` | 6382 | Active workflow modal state `{ recountId, rcItemId, type, scannedSerials[] }` |
| `rcMvState` | 6622 | Active movement panel state `{ recountId, rcItemId, type }` |

---

## Functions by Area

### Utilities & Helpers

| Function | Line | Purpose |
|----------|------|---------|
| `$(id)` | 137 | `document.getElementById` shorthand |
| `normalize(v)` | 141 | Trim + lowercase string |
| `normKey(v)` | 142 | Uppercase + trim for key comparison |
| `normalizeProductKey(v)` | 151 | Like `normKey` but also strips fancy dashes/spaces |
| `sanitizeScannerValue(v, opts)` | 180 | Strip control chars; optionally uppercase |
| `normalizeMacForComparison(v)` | 189 | Strip MAC separators for comparison |
| `looksLikeMac(v)` | 192 | Validate MAC format |
| `escapeHtml(v)` | 761 | HTML-escape for safe innerHTML injection |
| `csvEscape(v)` | 340 | Quote CSV fields with special chars |
| `downloadText(filename, text, type)` | 344 | Trigger browser file download |
| `getField(row, names)` | 143 | Flexible field extraction from row object |
| `commonValue(values)` | 196 | Most frequent value in array |
| `alphaPrefix(v)` | 203 | Extract leading alpha chars from string |
| `invNow()` | 1668 | Current ISO timestamp |
| `invFormatTime(iso)` | 1670 | `HH:MM:SS` from ISO string |
| `invFormatDateTime(iso)` | 1675 | Locale datetime from ISO string |
| `invGenerateId(prefix)` | 1680 | Unique ID (`prefix_timestamp_random`) |
| `invGenerateSessionId()` | 1684 | Session ID with date component |

---

### Storage / IndexedDB (`TimDB`)

| Function | Line | Purpose |
|----------|------|---------|
| `TimDB.get(key)` | 39 | Read from IndexedDB |
| `TimDB.set(key, val)` | 46 | Write to IndexedDB |
| `TimDB.remove(key)` | 53 | Delete from IndexedDB |
| `saveBatchDraft()` | 74 | Persist receiving batch to IDB |
| `clearBatchDraft()` | 91 | Delete receiving batch from IDB |
| `loadBatchDraft()` | 97 | Restore receiving batch from IDB |
| `restoreBatchDraft()` | 116 | Load batch + refresh UI |
| `timLoadMasterCache()` | 4289 | Load product_map + history from IDB on startup |
| `timSaveMasterCache()` | 4285 | Persist product_map + history to IDB |
| `invLoadStorageRaw()` | 1689 | Raw IDB read for current session |
| `invStorageAvailable()` | 1693 | Check IndexedDB availability |
| `scheduleInvAutosave()` | 1790 | Debounced (500ms) autosave trigger |
| `invAutosave()` | 1798 | Write session snapshot to IDB |

---

### CSV Column Mapper

> Shown automatically when TIM can't auto-detect a dropped CSV. Lets the user identify the data type and map their columns to TIM's expected field names before routing to the normal import handler.

| Function / Variable | Line | Purpose |
|---------------------|------|---------|
| `_CSV_IMPORT_TYPES` | 922 | Array of import type definitions (id, label, fields, run) — one entry per supported import |
| `_parseCsvToRowObjects(text)` | 906 | Parse CSV text into array of `{ header: value }` row objects |
| `_showCsvMapperModal(file, cols)` | 1016 | Open the mapper modal; renders type cards + detected column pills |
| `_csvMapperSampleData` | 1023 | `{ colNameLower: [val, …] }` — up to 10 sample values per column, built from first 8 KB of file |
| `_csvMapperUpdatePreview(sel)` | 1113 | Refresh the sample-value chip strip below a mapping `<select>` |
| `_csvMapperBuildFields(cols, typeId)` | 1126 | Populate Step 2 mapping table for selected import type; auto-matches on name; wires preview listeners |
| `_csvMapperDoImport()` | 1168 | Validate mapping (+ type-level `validate()` hook), rewrite headers, call the type's `run()` handler |
| `_remapCsvHeaders(text, mapping)` | 1206 | Rewrite CSV header row using `{ csvColLower → fieldKey }` mapping |

---

### Data Loading (Master JSON + Source File)

| Function | Line | Purpose |
|----------|------|---------|
| `loadJsonFile(file)` | 797 | Parse master JSON file |
| `loadSourceData(parsed, fileName)` | 807 | Ingest parsed master: populate `appData`, infer missing products, load quants + recount data |
| `inferProductMapFromHistory(records)` | 315 | Auto-create product entries from history records |
| `readSourceWorkbook(file)` | 524 | Read Calix or RMA source Excel/CSV |
| `readWorkbook(file)` | 419 | Parse Excel/CSV → array of row objects |
| `readWorkbookRawRows(file)` | 449 | Parse Excel/CSV → raw cell arrays |
| `readRmaWorkbook(file)` | 521 | Parse RMA-format workbook |
| `findHeaderRow(rawRows)` | 380 | Detect header row by column name matching |
| `rowsToObjects(rawRows, headerIdx)` | 402 | Convert raw rows → keyed objects |
| `parseRmaRows(rawRows)` | 486 | Parse RMA header/item row structure |
| `excelDateToISO(v)` | 354 | Convert Excel date serial → ISO string |

---

### Product Map Lookups

| Function | Line | Purpose |
|----------|------|---------|
| `findProductMapMatch(product)` | 157 | Find entry by key, HCTC, or default_code — returns `{ key, entry, matchedBy }` |
| `findProductMapEntry(product)` | 264 | Wrapper returning just the entry |
| `resolveCalixProduct(input, mapMatch)` | 279 | Resolve final product name with history fallback |
| `findHistoryProductByHctc(hctc)` | 267 | Resolve product name from history by HCTC |
| `getMapVendor(map)` | 175 | Extract vendor from map entry |
| `getMapDescription(map)` | 178 | Extract name/description from map entry |
| `getMapExternalId(map)` | 293 | Extract Odoo external ID |
| `mapRequiresFsan(map)` | 176 | Check if FSAN required |
| `mapHistoryOnly(map)` | 177 | Check if history-only (DNI) |
| `getTrackingType(map)` | 4340 | Returns `"serial" \| "reel" \| "none"` |
| `validateProductMapEntry(map)` | 302 | Validate entry for export (serial-tracked, ext ID, etc.) |
| `countBlockedTemplateMappings(productMap)` | 312 | Count entries with product_template IDs (invalid) |

---

### Receiving / Batch Processing

| Function | Line | Purpose |
|----------|------|---------|
| `processRows(rows)` | 597 | Core: map source rows → batch entries with validation |
| `previewMerge(existing, incoming)` | 571 | Detect merge conflicts |
| `mergeMissingFields(existing, incoming)` | 588 | Fill in missing fields from new row |
| `buildIndexes(records)` | 542 | Build serial/FSAN/MAC dedup sets |
| `buildHistorySerialIndex(records)` | 550 | Serial→record lookup index |
| `inferPatternProfile(product, map)` | 216 | Infer expected serial/FSAN pattern from history |
| `collectPatternWarnings(fields)` | 233 | Validate scan values against expected patterns |
| `formatPatternWarnings(warnings)` | 261 | Format warnings as HTML chips |
| `historyForProduct(product, map)` | 207 | Filter history records for a product |
| `renderSummary()` | 727 | Render batch stats |
| `renderBatch()` | 752 | Render batch table |
| `renderHistory(records)` | 764 | Render history records |
| `renderUnknownProducts()` | 770 | Show unmapped products |
| `renderAll()` | 795 | Refresh all receiving views |
| `runHistorySearch()` | 1034 | Search history records |

---

### Blind Receiving

| Function | Line | Purpose |
|----------|------|---------|
| `handleScannerEnter(e)` | 1445 | Keyboard handler for blind scan fields |
| `getBlindDeviceValues()` | 1157 | Extract + sanitize blind form fields |
| `addBlindDeviceToQueue()` | 1313 | Validate + add device to blind queue |
| `processBlindQueue()` | 1407 | Merge blind queue into batch |
| `renderBlindQueue()` | 1391 | Render blind queue table |
| `loadBlindQueueRow(index)` | 1368 | Load queue item for editing |
| `removeBlindQueueRow(index)` | 1400 | Remove queue item |
| `findBlindDuplicateConflict(values, editIdx)` | 1246 | Check for serial/FSAN/MAC duplicates |
| `assertBlindQueueHasNoDuplicates()` | 1274 | Validate entire queue for dupes |
| `updateBlindLookup()` | 1096 | Lookup product and show mapping info |
| `saveBlindMapping()` | 1120 | Save blind product mapping |
| `clearBlindDeviceFields()` | 1145 | Clear blind entry form |
| `updateBlindPatternHint()` | 1169 | Show pattern warnings for current blind entry |
| `prefillBlindFromHistory(record)` | 1226 | Pre-fill blind form from history match |
| `lookupDeviceInHistory(v)` | 1216 | Find device by serial/FSAN/MAC in history |
| `renderRecentBlindSerials()` | 1180 | Show recent serials in blind mode |
| `getBlindMap()` | 1093 | Get current blind product mapping |

---

### Inventory — Session Lifecycle

| Function | Line | Purpose |
|----------|------|---------|
| `invAutoRestoreSession()` | 1896 | **Silent auto-restore on page load** from IDB; guards with `_invAutoRestoreStarted` |
| `invStartNewSession()` | 1855 | Create fresh session + autosave |
| `invResumeSession()` | 1926 | Manual "Resume Session" button (shows alert) |
| `invClearSession()` | 1949 | Clear session from memory + IDB |
| `invFinalizeSession()` | 4641 | Close session + merge events into master data |
| `invResetSessionState()` | 1847 | Zero out events/exceptions/recounts/sequence |
| `invExportBackup()` | 1966 | Export session JSON to file |
| `invImportBackup(input)` | 1991 | Import session from JSON file |
| `invShowStorageHint()` | 1763 | Show autosave bar hint if saved session found (skips if `_invAutoRestoreStarted`) |
| `invCreateEvent(type, data)` | 1821 | Create + store event; triggers autosave |

---

### Inventory — UI Rendering

| Function | Line | Purpose |
|----------|------|---------|
| `renderInvSessionUI()` | 2037 | Top-level: show/hide all session sections |
| `renderInvSessionMeta()` | 2023 | Update session name/date/counts header |
| `renderInvSidebarSession()` | 2049 | Update sidebar session indicator + stats |
| `renderInvStatusBar()` | 2077 | Update mode pill, location, event count |
| `renderInvEventLog()` | 2112 | Render event log table (filterable) |
| `renderInvSummary()` | 2216 | Render per-item summary (qty, footage) |
| `renderInvExceptions()` | 3360 | Render exceptions panel |
| `renderInvActivityFeed()` | 1626 | Render activity feed |
| `invAddActivity(type, msg, detail)` | 1614 | Append to activity feed + beep |
| `invClearActivityFeed()` | 1621 | Clear activity feed |
| `invSetScanFeedback(msg, type, detail)` | 2620 | Show scan result message + log to activity |

---

### Inventory — Scanning Core

| Function | Line | Purpose |
|----------|------|---------|
| `invProcessScan()` | 3193 | **Main scan entry point** — reads input, routes to handler |
| `invClassifyScan(raw)` | 2507 | Detect scan type: `fsan \| box_id \| location \| reel_number \| serial \| item_number \| barcode \| mac \| unknown` |
| `invUpdateDetectedBadge(raw)` | 2563 | Update scan-type badge in UI |
| `invGetScanMeta(type, value)` | 3297 | Resolve item/description metadata for scan value |
| `invShowScanMeta(meta)` | 3329 | Display metadata badge below scan field |
| `invHideScanMeta()` | 3346 | Hide metadata badge |
| `invClearScanInput()` | 3351 | Clear scan field + feedback |
| `invSetScanMode(mode)` | 2906 | Switch `invScanMode`; updates UI + keypad |
| `invSetLocation(loc)` | 3047 | Set/clear sticky location |

---

### Inventory — Scan Handlers

| Function | Line | Purpose |
|----------|------|---------|
| `invHandleSerializedScan(value, type, ctx, notes, loc)` | 2833 | Process serial/FSAN scan → event or exception |
| `invHandleBoxScan(boxId, ctx, notes, loc)` | 2904 | Process box scan → count devices inside |
| `invHandleBulkCount(itemNum, qty, notes, loc)` | 2964 | Record bulk quantity count |
| `invHandleMacScan(mac, ctx, notes, loc)` | 3027 | Process MAC scan → resolve → serial handler |
| `invHandleReelScan(reelNum, notes, loc)` | 3683 | Process reel scan → open reel entry panel |
| `invFindSerializedDuplicate(serial, fsan)` | 2594 | Check if serial/FSAN already in session |
| `invResolveBySerial(key)` | 2575 | Look up history record by serial |
| `invResolveByFsan(key)` | 2581 | Look up history record by FSAN |
| `invResolveByMac(mac)` | 2587 | Look up history record by MAC |
| `invCreateExceptionEvent(value, type, problem, action, notes)` | 2607 | Create exception event |

---

### Inventory — Reel Entry

| Function | Line | Purpose |
|----------|------|---------|
| `invOpenReelModal(reelNum, notes, loc)` | 3749 | Populate and show reel entry panel; reverse-looks up item if blank |
| `invPrefillReelItemNumber(itemNum, notes, loc)` | 3692 | Pre-fill reel form from item number |
| `invAutoSaveReelInline()` | 3399 | Silently save current reel before switching to next |
| `invReelUpdateSpanTypeFromContext()` | 3491 | **Auto-set span type** from history → product map → default; also fills item from reel |
| `invReelSpanTypeChange()` | 3522 | Show/hide Span B section; recalc footage |
| `invCalcReelFt()` | 3529 | Calculate footage from inner/outer seq numbers |
| `invReelUpdateHistoryPanel(item, reel, ft)` | 3554 | Show previous footage comparison |
| `invFindReelMaster(reelNum)` | 3578 | **Reverse lookup**: find any event with this reel# across all sessions |
| `invGetReelHistory(itemNum, reelNum)` | 3592 | Find most recent event for item+reel pair (searches both `invEvents` + `appData.inventory_events`) |
| `invSubmitReelEntry(silent)` | 3607 | Validate + save reel count event |
| `invClearReelFields()` | 3663 | Reset all reel form fields |
| `invCloseReelInline()` | 3683 | Close reel panel |
| `invDiscardReelEntry()` | 3708 | Discard reel + log exception |

---

### Inventory — Quantity Keypad

| Function | Line | Purpose |
|----------|------|---------|
| `invShowQtyKeypad(eventId, itemNum, desc)` | 2999 | Show keypad for bulk count |
| `invShowLockedKeypad()` | 3212 | Show locked keypad (forced qty=1) |
| `invHideQtyKeypad()` | 3017 | Reset keypad to idle |
| `invQtyKeyDigit(d)` | 3074 | Append digit to quantity display |
| `invQtyKeySign()` | 3096 | Toggle sign |
| `invQtyKeyBackspace()` | 3118 | Delete last digit |
| `invQtyKeyClear()` | 3136 | Reset to 1 |
| `invQtyKeySkip()` | 3149 | Skip item |
| `invQtyKeyApply()` | 3162 | Apply quantity to event |
| `invKeyFocusField(target)` | 3104 | Focus specific reel input for keypad entry |
| `invQtyKeypadRefreshReelTarget()` | 3040 | Highlight active reel field |
| `invQtyRefreshDisplay()` | 3032 | Update numeric display |

---

### Inventory — Event Editing

| Function | Line | Purpose |
|----------|------|---------|
| `invVoidEvent(eventId)` | 2377 | Void event (audit trail preserved) |
| `invUndoVoid(eventId)` | 2396 | Restore voided event |
| `invOpenNotesModal(eventId)` | 2415 | Open notes editor |
| `invSaveNotesModal()` | 2464 | Save notes to event |
| `invCloseNotesModal()` | 2476 | Close notes modal |
| `invEditEventQty(eventId)` | 2483 | Edit bulk event quantity inline |
| `invToggleFlag(eventId)` | 2830 | Toggle recount flag on event |

---

### Inventory — Serial Prompt (Unknown Device)

| Function | Line | Purpose |
|----------|------|---------|
| `invShowSerialPrompt(value, type, loc)` | 4073 | Show "unknown device" entry dialog |
| `invHideSerialPrompt()` | 3754 | Close dialog |
| `invCommitSerialPrompt()` | 3763 | Validate + record manually-entered device |
| `invCancelSerialPrompt()` | 3815 | Abandon + log exception |

---

### Inventory — Odoo Data Imports

| Function | Line | Purpose |
|----------|------|---------|
| `invImportQuantsBaseline(file)` | 5050 | Load Quants CSV file |
| `invProcessOdooQuantCsv(text, fileName)` | 5060 | Parse Quants CSV → upsert `invQuantsBaseline`; accepts `quantity` or `inventory_quantity_auto_apply` |
| `invRenderQuantsBaselineStatus()` | 5011 | Update Quants status chip in UI |
| `invSaveQuantsBaseline()` | 5026 | Persist quants to IDB + `appData.odoo_quants` |
| `invLoadQuantsBaseline()` | 5031 | Restore quants from IDB on startup |
| `invClearQuantsBaseline()` | 5042 | Clear quants from memory + IDB |
| `invGetQuantId(defCode, locValue, lotName)` | 4739 | Look up quant record by item+location+lot |
| `invRenderQuantMapStatus()` | 4763 | Update quant map status chip |
| `invSaveOdooQuantMap()` | 4779 | Persist quant map to IDB |
| `invLoadOdooQuantMap()` | 4783 | Restore quant map from IDB |
| `invClearOdooQuantMap()` | 4792 | Clear quant map |
| `invImportOdooQuantsCsv(file)` | 4798 | Load Inv Adj Sync CSV file |
| `invProcessOdooQuantCsv(text, fileName)` | 4808 | Parse Inv Adj Sync CSV → update quant map |
| `invImportLocationMapCsv(file)` | 4937 | Load Location Map CSV file |
| `invProcessLocationMapCsv(text, fileName)` | 4947 | Parse Location CSV → build path↔barcode maps |
| `invLocationPathToBarcode(path)` | 4882 | Convert location path to barcode |
| `invLocationBarcodeToCompleteName(barcode)` | 4888 | Convert location barcode to display name |
| `invRenderLocationMapStatus()` | 4894 | Update Location Map status chip |
| `invSaveLocationMap()` | 4910 | Persist location maps to IDB |
| `invLoadLocationMap()` | 4915 | Restore location maps from IDB |
| `invClearLocationMap()` | 4929 | Clear location maps |

---

### Inventory — Gap Analysis / Variance Report

| Function | Line | Purpose |
|----------|------|---------|
| `invRunGapAnalysis()` | 5714 | Entry point — validates prerequisites + calls build |
| `invBuildGapReport()` | 5735 | **Core**: compare active session events vs `invQuantsBaseline`; returns `{ serialized, bulk, reels }` gap report |
| `invRenderGapReport(report)` | 5843 | Render gap report card with collapsible sections + summary chips |

---

### Inventory — Legacy Recount (Session-Level)

> These functions manage recount workflows *within* an active inventory session (scan-based walkthrough). For the post-submission Recount Manager, see the **Recount Manager** section below.

| Function | Line | Purpose |
|----------|------|---------|
| `invStartRecount()` | 3846 | Start recount workflow from closed session |
| `invBuildRecountFromParent()` | 3888 | Populate recount list from parent session |
| `invAddToRecountList()` | 3913 | Manually add item to recount |
| `renderRecountQueue()` | 3941 | Render recount queue + progress |
| `invRecountBeginWalkthrough()` | 3976 | Start guided walkthrough |
| `invRecountEndWalkthrough()` | 3984 | End walkthrough |
| `invRecountShowCurrent()` | 3991 | Display current recount item |
| `invRecountSaveItem()` | 4022 | Record recount count |
| `invRecountSkipItem()` | 4060 | Skip current item |

---

### Inventory — CSV Import (Reels)

| Function | Line | Purpose |
|----------|------|---------|
| `invImportReelsCsv(inputEl)` | 5394 | Load reel CSV file |
| `_parseReelCsv(text)` | 5414 | Parse CSV text → row arrays |
| `_analyzeReelCsvRows(rows)` | 5446 | Determine action per row: add / update / skip / skip_active |
| `_showCsvImportModal(parsed)` | 5522 | Show preview modal with counts |
| `invConfirmCsvImport()` | 5590 | Execute import: create events + export master |
| `invCancelCsvImport()` | 5584 | Close modal |

---

### Inventory — Exports

| Function | Line | Purpose |
|----------|------|---------|
| `exportInvEventLogCsv()` | 2352 | Export event log to CSV |
| `exportInvSummaryCsv()` | 2363 | Export summary to CSV |
| `exportInvEventLogXlsx()` | 4114 | Export event log to XLSX |
| `exportInvSummaryXlsx()` | 4125 | Export summary to XLSX |
| `exportRecountXlsx()` | 4067 | Export recount results to XLSX |
| `invMakeXlsx(headers, rows, sheet)` | 4104 | Build XLSX workbook |
| `buildEventLogBaseRow(e)` | 4313 | Build common CSV/XLSX fields for an event |
| `buildInvSummaryMap(events)` | 4332 | Aggregate events by item |
| `buildExportPayload()` | 4320 | Build full master JSON payload (10yr purge); includes `odoo_quants`, `recount_sessions`, `recount_movements` |
| `requireInvSession()` | 2306 | Guard: alert if no active session |

---

### Recount Manager

> Post-submission recount workflow. Manages sessions, physical recount workflows, movement records, resolution status, and XLSX output. Data persisted in `RC_STORAGE_KEY` (`tim_recount_v1`) and mirrored into `appData`.

#### Storage & Init

| Function | Line | Purpose |
|----------|------|---------|
| `rcLoadStorage()` | 5991 | Restore `rcSessions` + `rcMovements` from IDB on startup |
| `rcSaveStorage()` | 5985 | Persist to IDB + sync into `appData` |
| `rcLoadFromAppData()` | 6004 | Load from `appData` after master JSON import |
| `rcGenSessionId()` | 6013 | Generate `rc_YYYYMMDDHHNN_xxx` ID |
| `rcGenItemId()` | 6018 | Generate `rci_...` item ID |

#### Session Management

| Function | Line | Purpose |
|----------|------|---------|
| `rcOpenCreateFromGaps()` | 6024 | Pre-populate create form from current gap report |
| `rcShowCreate(fromGaps)` | 6049 | Show create session form |
| `rcCancelCreate()` | 6082 | Cancel create form |
| `rcConfirmCreate()` | 6088 | Build + save new recount session; switch to detail view |
| `rcShowList()` | 6121 | Switch to session list view |
| `rcShowDetail(recountId)` | 6127 | Switch to session detail view |
| `rcAddManualItem()` | 6348 | Manually add item to session discrepancy list |
| `rcDeleteItem(recountId, rcItemId, type)` | 6340 | Remove item from session |
| `rcSetNiscQty(recountId, rcItemId, type, val)` | 6330 | Set NISC expected quantity on an item |

#### UI Rendering

| Function | Line | Purpose |
|----------|------|---------|
| `rcRenderCard()` | 6135 | Top-level render — switches list/create/detail view |
| `rcRenderList()` | 6158 | Render session list |
| `rcRenderDetail()` | 6186 | Render session detail with all three item type sections |
| `rcRenderDiscrepancySection(session, type)` | 6232 | Render serialized / bulk / reels discrepancy table |

#### Physical Recount Workflows

| Function | Line | Purpose |
|----------|------|---------|
| `rcOpenWorkflow(recountId, rcItemId, type)` | 6384 | Open workflow modal for an item |
| `rcCloseWorkflow()` | 6429 | Close workflow modal; null `rcWfState` |
| `rcWfBuildSerialBody(item)` | 6437 | Build serialized scan UI (accumulator + list) |
| `rcWfBuildBulkBody(item)` | 6511 | Build bulk qty entry UI |
| `rcWfBuildReelBody(item)` | 6529 | Build reel inner/outer entry UI |
| `rcWfScanKeydown(e)` | 6464 | Handle Enter key in serial scan field |
| `rcWfScanAdd()` | 6468 | Add scanned serial to accumulator (dedup alert) |
| `rcWfRemoveSerial(idx)` | 6486 | Remove serial from accumulator |
| `rcWfRefreshSerialList()` | 6492 | Re-render serial accumulator list |
| `rcWfCalcFt()` | 6557 | Calculate footage from inner/outer sequences |
| `rcWorkflowConfirm()` | 6572 | Validate + save workflow result; set item status `"complete"` |

#### Movement Records

| Function | Line | Purpose |
|----------|------|---------|
| `rcOpenMovementPanel(recountId, rcItemId, type)` | 6656 | Open movement panel for an item |
| `rcCloseMovementPanel()` | 6674 | Close panel + re-render detail (refreshes movement count badges) |
| `rcRenderMovementPanel()` | 6684 | Render full movement panel (attached + existing + create form) |
| `rcRenderMovementCard(m, canDetach)` | 6744 | Render single movement record card |
| `rcMvCreateAndAttach()` | 6807 | Validate + create new movement record + attach to item |
| `rcMvAttachExisting()` | 6778 | Attach existing global movement to current item |
| `rcMvDetach(movementId)` | 6794 | Detach movement from item |
| `rcGenMovementId()` | 6650 | Generate `mv_...` movement ID |
| `rcResolutionSelect(recountId, rcItemId, type, val)` | 6633 | Build resolution status `<select>` HTML |
| `rcSetResolution(recountId, rcItemId, type, val)` | 6641 | Save resolution status on item |

#### XLSX Export

| Function | Line | Purpose |
|----------|------|---------|
| `rcExportXlsx(recountId)` | 6971 | Export three-tab XLSX (Serialized / Bulk / Reels) with chain history |
| `rcBuildChain(session)` | 6852 | Walk `parentId` chain back through recount + inventory sessions |
| `rcChainHistoryForItem(chain, item, type)` | 6880 | Per-session history lookup for chain columns |
| `rcMovementsSummary(item)` | 6933 | Format movements as multi-line summary string |
| `rcResolutionLabel(val)` | 6948 | Convert snake_case resolution key → readable label |
| `rcAutoColWidths(headers, rows)` | 6959 | Auto-size XLSX columns (max 60 chars) |

---

### Products / Catalog

| Function | Line | Purpose |
|----------|------|---------|
| `prodRenderList()` | 4352 | Render product table with search filter |
| `buildCatalogRowCells(key, map)` | 5066 | Build HTML cells for one product row |
| `prodRenderOneRow(key)` | 5089 | Re-render single row in place |
| `prodEditProduct(key)` | 5299 | Open product edit modal |
| `prodEditTrackingChanged()` | 5325 | Update form when tracking type changes |
| `prodSaveEdit()` | 5335 | Save product edits to `PRODUCT_MAP` |
| `prodCancelEdit()` | 5383 | Close edit modal |
| `prodShowSaveToast(msg)` | 5105 | Temporary save confirmation |
| `prodShowItemHistory(itemNum)` | 4525 | Show receiving + inventory history modal |
| `prodCloseHistoryModal()` | 4618 | Close history modal |
| `prodDownloadTemplate()` | 4389 | Download bulk-upload CSV template |
| `prodBulkUpload(file)` | 4405 | Process bulk product upload |
| `prodShowUploadDiff(diff)` | 5219 | Show upload diff preview |
| `prodApplyUpload()` | 5270 | Apply upload changes |
| `prodCancelUpload()` | 5288 | Cancel upload |
| `prodExportMasterJson()` | 4623 | Download current master JSON |
| `prodToggleNotes()` | 4347 | Toggle help text panel |

---

### Barcode Assignment

| Function | Line | Purpose |
|----------|------|---------|
| `bcProcessBarcodeScan()` | 4758 | Process barcode scan input |
| `bcProcessItemNumber()` | 4809 | Link scanned barcode to item number |
| `bcAddToBatch(barcode, item, desc, known)` | 4846 | Add/update barcode in batch |
| `bcIncludeKnown(idx)` | 4860 | Mark known barcode for inclusion |
| `bcRemoveFromBatch(idx)` | 4864 | Remove from batch |
| `bcRenderBatch()` | 4869 | Render barcode batch table |
| `bcClearBatch()` | 4896 | Clear all barcode batch entries |
| `bcExportAndSave()` | 4906 | Export to Odoo CSV + save to `BARCODE_MAP` |
| `bcImportOdooCsv(file)` | 4962 | Import Odoo barcode CSV |
| `bcProcessOdooImport(text, fileName)` | 4974 | Parse + merge Odoo barcode CSV |
| `bcLoadBarcodeMap()` | 4721 | Restore barcode map from IDB |
| `bcSaveBarcodeMapToStorage()` | 4730 | Persist barcode map to IDB |
| `bcSaveBatchDraft()` | 4734 | Save barcode batch to IDB |
| `bcLoadBatchDraft()` | 4738 | Restore barcode batch from IDB |
| `bcShowFeedback(type, msg)` | 4747 | Show scan feedback |
| `bcCancelUnknown()` | 4837 | Cancel unknown barcode linking |
| `bcParseCsvRow(line)` | 5037 | Parse quoted CSV row |

---

### UI / Navigation

| Function | Line | Purpose |
|----------|------|---------|
| `switchTab(name)` | 1698 | Switch main tab; persists to localStorage |
| `toggleSidebar()` | 1719 | Collapse/expand left sidebar |
| `updateSidebarStatus(step, rows)` | 1726 | Update sidebar file-loaded indicators |
| `toggleMoreDropdown(e)` | 1742 | Toggle "More" menu |
| `toggleCollapsible(bodyId, headerId, chevronId)` | 1752 | Expand/collapse card |
| `setDropState(dropId, statusId, loaded, msg)` | 532 | Update drop zone loaded state |
| `updateClearBtns()` | 5116 | Show/hide clear buttons based on data presence |
| `prefillMapping(product, desc)` | 1023 | Pre-fill product mapping form |
| `timInitUsername()` | 1570 | Load + display stored username |
| `timGetUsername()` | 1561 | Read username from localStorage |
| `timSetUsername(val)` | 1564 | Save username to localStorage |
| `checkForUpdate()` | 1500 | Check GitHub Pages for newer version |

---

### Location (Inventory)

| Function | Line | Purpose |
|----------|------|---------|
| `invToggleLocPopover(e)` | 3074 | Toggle location picker |
| `invLocPopoverSet()` | 3087 | Set location from popover |
| `invCloseLocPopover()` | 3095 | Close location popover |
| `invClearLocation()` | 3100 | Clear current location |

---

### Audio

| Function | Line | Purpose |
|----------|------|---------|
| `_timAudioCtx_get()` | 1578 | Get/create AudioContext (inventory mode) |
| `timUnlockAudio()` | 1585 | Resume suspended AudioContext on user gesture |
| `timBeep(type)` | 1589 | Beep: `"ok" \| "warn" \| "error"` (inventory) |
| `getAudioCtx()` | 1192 | Get/create AudioContext (receiving mode) |
| `playBeep(type)` | 1196 | Beep: `"ok" \| "error"` (receiving mode) |

---

### Clear / Reset Operations

| Function | Line | Purpose |
|----------|------|---------|
| `clearAllData()` | 5130 | Wipe everything (products, history, batch, barcodes) |
| `clearMasterData()` | 5146 | Clear products + history + barcodes only |
| `clearSourceData()` | 5167 | Clear source file + batch only |
| `clearProductCatalog()` | 5180 | Clear product map only |
| `clearBarcodeImport()` | 5195 | Clear barcode map only |

---

## Service Worker (`sw.js`)

| Event | Strategy | Notes |
|-------|----------|-------|
| `install` | Precache CDN + local files | Calls `skipWaiting()` — activates immediately |
| `activate` | Delete old caches | `clients.claim()` — takes over existing pages |
| `fetch` | Skip non-HTTP requests (chrome-extension guard) | CDN → cache-first; local → network-first with cache fallback |

**Precached:** `xlsx@0.18.5`, `JsBarcode@3.11.6`, `manifest.json`, `styles.css`, `app.js`

**To deploy an update:** bump `CACHE` version → old cache evicted on next activate.
