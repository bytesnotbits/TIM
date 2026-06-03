
const APP_VERSION = "v2.01.07";

// Stamp version into title bar, app header, and schema docs heading
document.title = document.title.replace(/v[\d.]+$/, APP_VERSION);
const _verSpan = document.querySelector('.app-version');
if (_verSpan) _verSpan.textContent = APP_VERSION;
const _schemaH3 = document.getElementById('schema-version-heading');
if (_schemaH3) _schemaH3.textContent = `Master JSON Schema (${APP_VERSION})`;

let appData = { product_map: {}, history: { records: [] }, inventory_sessions: [], inventory_events: [], barcode_map: {}, odoo_quants: [] };
let PRODUCT_MAP = appData.product_map;
let BARCODE_MAP = appData.barcode_map;
let history = appData.history;
let currentBatch = [];
let lastLoadedRows = [];
let lastExportRows = [];
let importedPending = false;
let blindQueue = [];
let activeBlindMapMatch = null;
let blindQueueEditIndex = -1;
let recentBlindSerials = [];

// ── IndexedDB key-value store (replaces localStorage for all data) ──
const TimDB = (() => {
  let _db = null;
  const DB_NAME = "tim_db";
  const DB_VERSION = 1;
  const STORE = "kv";
  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => e.target.result.createObjectStore(STORE, { keyPath: "key" });
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror = e => reject(e.target.error);
    });
  }
  function get(key) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = e => reject(e.target.error);
    }));
  }
  function set(key, value) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).put({ key, value });
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    }));
  }
  function remove(key) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readwrite").objectStore(STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    }));
  }
  return { get, set, remove };
})();

// -- Batch draft persistence ----------------------------------------
const BATCH_DRAFT_KEY = "tim_batch_draft_v1";
let batchDraftTimer = null;

function scheduleBatchDraftSave() {
  clearTimeout(batchDraftTimer);
  const st = document.getElementById("batchDraftSaveStatus");
  if (st) { st.textContent = "Unsaved"; st.className = "inv-status-save unsaved"; st.classList.remove("hidden"); }
  batchDraftTimer = setTimeout(saveBatchDraft, 500);
}

function saveBatchDraft() {
  if (!currentBatch.length && !blindQueue.length) { clearBatchDraft(); return; }
  const payload = {
    schemaVersion: "1.0",
    savedAt: new Date().toISOString(),
    currentBatch: currentBatch,
    blindQueue: blindQueue,
    importedPending: importedPending
  };
  const st = document.getElementById("batchDraftSaveStatus");
  TimDB.set(BATCH_DRAFT_KEY, payload).then(function() {
    if (st) { st.textContent = "Draft saved " + new Date().toLocaleTimeString(); st.className = "inv-status-save"; st.classList.remove("hidden"); }
  }).catch(function() {
    if (st) { st.textContent = "Draft: memory only"; st.className = "inv-status-save unsaved"; st.classList.remove("hidden"); }
  });
}

function clearBatchDraft() {
  TimDB.remove(BATCH_DRAFT_KEY).catch(function(){});
  const st = document.getElementById("batchDraftSaveStatus");
  if (st) { st.textContent = ""; st.className = "inv-status-save hidden"; }
}

function loadBatchDraft() {
  TimDB.get(BATCH_DRAFT_KEY).then(function(payload) {
    if (!payload) return;
    const batchCount = (payload.currentBatch || []).length;
    const queueCount = (payload.blindQueue || []).length;
    if (!batchCount && !queueCount) { clearBatchDraft(); return; }
    const banner = document.getElementById("batchDraftBanner");
    const text = document.getElementById("batchDraftBannerText");
    if (banner && text) {
      const parts = [];
      if (batchCount) parts.push(batchCount + " batch row" + (batchCount !== 1 ? "s" : ""));
      if (queueCount) parts.push(queueCount + " blind receive item" + (queueCount !== 1 ? "s" : ""));
      const when = payload.savedAt ? " (saved " + new Date(payload.savedAt).toLocaleTimeString() + ")" : "";
      text.textContent = "Unsaved batch found: " + parts.join(" and ") + when + ". Restore?";
      banner.style.display = 'flex';
    }
  }).catch(function() {});
}

function restoreBatchDraft() {
  TimDB.get(BATCH_DRAFT_KEY).then(function(payload) {
    if (!payload) return;
    currentBatch = payload.currentBatch || [];
    blindQueue = payload.blindQueue || [];
    importedPending = payload.importedPending || false;
    const banner = document.getElementById("batchDraftBanner");
    if (banner) banner.style.display = 'none';
    renderAll();
    renderBlindQueue();
    const st = document.getElementById("batchDraftSaveStatus");
    if (st) { st.textContent = "Draft restored"; st.className = "inv-status-save"; st.classList.remove("hidden"); }
  }).catch(function() { clearBatchDraft(); });
}

function dismissBatchDraft() {
  clearBatchDraft();
  const banner = document.getElementById("batchDraftBanner");
  if (banner) banner.style.display = 'none';
}

const $ = id => document.getElementById(id);
$("mapPreview").value = JSON.stringify(PRODUCT_MAP, null, 2);


function normalize(v) { return String(v ?? "").trim(); }
function normKey(v) { return normalize(v).toUpperCase(); }
function getField(row, names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const found = keys.find(k => k.trim().toLowerCase() === n.toLowerCase());
    if (found) return normalize(row[found]);
  }
  return "";
}
function normalizeProductKey(v) {
  return normalize(v)
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\s+/g, "")
    .toUpperCase();
}
function findProductMapMatch(product) {
  const direct = PRODUCT_MAP[product];
  if (direct) return { key: product, entry: direct, matchedBy: "product" };

  const target = normalizeProductKey(product);
  if (!target) return null;

  const foundKey = Object.keys(PRODUCT_MAP).find(key => normalizeProductKey(key) === target);
  if (foundKey) return { key: foundKey, entry: PRODUCT_MAP[foundKey], matchedBy: "product" };

  const foundHctcKey = Object.keys(PRODUCT_MAP).find(key => PRODUCT_MAP[key] && normalizeProductKey(PRODUCT_MAP[key].hctc) === target);
  if (foundHctcKey) return { key: foundHctcKey, entry: PRODUCT_MAP[foundHctcKey], matchedBy: "hctc" };

  const foundDefaultCodeKey = Object.keys(PRODUCT_MAP).find(key => PRODUCT_MAP[key] && normalizeProductKey(PRODUCT_MAP[key].default_code) === target);
  if (foundDefaultCodeKey) return { key: foundDefaultCodeKey, entry: PRODUCT_MAP[foundDefaultCodeKey], matchedBy: "hctc" };

  return null;
}
function getMapVendor(map) { return normalize(map?.vendor || map?.Vendor || ""); }
function mapRequiresFsan(map) { return !!(map?.requires_fsan || map?.requires_fsan_name || map?.fsan_required); }
function mapHistoryOnly(map) { return !!(map?.history_only || map?.historyOnly); }
function getMapDescription(map) { return normalize(map?.name || map?.description || map?.odoo_name || ""); }

function sanitizeScannerValue(value, options = {}) {
  let s = String(value ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .trim();
  if (options.collapseSpaces !== false) s = s.replace(/\s+/g, " ");
  if (options.uppercase) s = s.toUpperCase();
  return s;
}
function normalizeMacForComparison(value) {
  return sanitizeScannerValue(value, { uppercase: true }).replace(/[^0-9A-F]/g, "");
}
function looksLikeMac(value) {
  const compact = normalizeMacForComparison(value);
  return !compact || /^[0-9A-F]{12}$/.test(compact);
}
function commonValue(values) {
  const counts = new Map();
  values.filter(Boolean).forEach(v => counts.set(v, (counts.get(v) || 0) + 1));
  let best = "", bestCount = 0;
  counts.forEach((count, value) => { if (count > bestCount) { best = value; bestCount = count; } });
  return bestCount >= 3 ? best : "";
}
function alphaPrefix(value) {
  const match = sanitizeScannerValue(value, { uppercase: true }).match(/^[A-Z]+/);
  return match ? match[0] : "";
}
function historyForProduct(product, map) {
  const productKey = normalizeProductKey(product);
  const hctcKey = normalizeProductKey(map?.hctc || product);
  return (history.records || []).filter(record => {
    const recordProduct = normalizeProductKey(record.calix_product || record.product || record.Product);
    const recordHctc = normalizeProductKey(record.hctc || record.default_code || record["HCTC Item"]);
    return (productKey && recordProduct === productKey) || (hctcKey && recordHctc === hctcKey);
  });
}
function inferPatternProfile(product, map) {
  const vendor = getMapVendor(map).toLowerCase();
  const records = historyForProduct(product, map);
  const serials = records.map(r => sanitizeScannerValue(r.serial || r.ref, { uppercase: true })).filter(Boolean);
  const fsans = records.map(r => sanitizeScannerValue(r.fsan || r.name, { uppercase: true })).filter(Boolean);
  const serialLengths = serials.map(v => String(v.length));
  const fsanLengths = fsans.map(v => String(v.length));
  const serialPrefixes = serials.map(alphaPrefix).filter(v => v && v.length >= 2);
  const fsanPrefixes = fsans.map(alphaPrefix).filter(v => v && v.length >= 2);
  return {
    sampleSize: records.length,
    serialLength: commonValue(serialLengths),
    serialPrefix: commonValue(serialPrefixes),
    fsanLength: commonValue(fsanLengths),
    fsanPrefix: commonValue(fsanPrefixes) || ((vendor.includes("calix") || mapRequiresFsan(map)) ? "CXNK" : "")
  };
}
function collectPatternWarnings({ product, map, serial, fsan, mac }) {
  const warnings = [];
  const profile = inferPatternProfile(product, map || {});
  const cleanSerial = sanitizeScannerValue(serial, { uppercase: true });
  const cleanFsan = sanitizeScannerValue(fsan, { uppercase: true });
  const cleanMac = sanitizeScannerValue(mac, { uppercase: true });

  if (cleanMac && !looksLikeMac(cleanMac)) {
    warnings.push("warning: MAC does not look like 12 hex characters after cleanup");
  }
  if (cleanFsan) {
    if (profile.fsanPrefix && !cleanFsan.startsWith(profile.fsanPrefix)) {
      warnings.push("warning: FSAN does not match expected prefix " + profile.fsanPrefix);
    }
    if (profile.fsanLength && cleanFsan.length !== Number(profile.fsanLength)) {
      warnings.push("warning: FSAN length " + cleanFsan.length + " differs from usual length " + profile.fsanLength + " for this item");
    }
  }
  if (cleanSerial) {
    if (profile.serialPrefix && !cleanSerial.startsWith(profile.serialPrefix)) {
      warnings.push("warning: serial prefix differs from usual prefix " + profile.serialPrefix + " for this item");
    }
    if (profile.serialLength && cleanSerial.length !== Number(profile.serialLength)) {
      warnings.push("warning: serial length " + cleanSerial.length + " differs from usual length " + profile.serialLength + " for this item");
    }
  }
  return warnings;
}
function formatPatternWarnings(warnings) {
  return warnings.length ? warnings.map(w => "<span class='warning-chip'>" + escapeHtml(w.replace(/^warning:\s*/i, "")) + "</span>").join(" ") : "No pattern warnings.";
}
function findProductMapEntry(product) {
  return findProductMapMatch(product)?.entry || null;
}
function findHistoryProductByHctc(hctc) {
  const target = normalizeProductKey(hctc);
  if (!target) return "";

  const found = (history.records || []).find(record => {
    const recordHctc = normalizeProductKey(record.hctc || record.default_code || record["HCTC Item"]);
    const recordProduct = normalize(record.calix_product || record.product || record.Product);
    return recordProduct && recordHctc === target && normalizeProductKey(recordProduct) !== target;
  });

  return normalize(found?.calix_product || found?.product || found?.Product);
}
function resolveCalixProduct(inputProduct, mapMatch) {
  const original = normalize(inputProduct);
  if (!original) return "";

  const historyProduct = findHistoryProductByHctc(original);
  if (historyProduct) return historyProduct;

  if (mapMatch?.matchedBy === "hctc" && mapMatch.key && normalizeProductKey(mapMatch.key) !== normalizeProductKey(original)) {
    return mapMatch.key;
  }

  return original;
}

function getMapExternalId(map) {
  return normalize(map?.odoo_external_id ?? map?.external_id);
}
function getRecordExternalId(record) {
  return normalize(record?.odoo_external_id ?? record?.external_id ?? record?.product_external_id ?? record?.["Product/External ID"] ?? record?.["External ID"]);
}
function getRecordMac(record) {
  return normalize(record?.mac_address ?? record?.mac ?? record?.x_studio_mac_address ?? record?.["MAC Address"] ?? record?.["MAC"]);
}
function validateProductMapEntry(map) {
  if (!map) return { ok: false, message: "no mapping found" };
  const externalId = getMapExternalId(map);
  if (!map.serial_tracked) return { ok: true, message: "not serial-tracked" };
  if (!externalId) return { ok: false, message: "missing Product Variant external ID" };
  if (/product_template/i.test(externalId)) {
    return { ok: false, message: "Product Template external ID blocked; export External ID from Product Variants so it points to product.product" };
  }
  return { ok: true, message: "ok" };
}
function countBlockedTemplateMappings(productMap) {
  return Object.values(productMap || {}).filter(entry => entry && entry.serial_tracked && /product_template/i.test(getMapExternalId(entry))).length;
}
function inferProductMapFromHistory(records) {
  let added = 0;

  (records || []).forEach(record => {
    const product = normalize(record.calix_product || record.product || record.Product);
    if (!product || findProductMapEntry(product)) return;

    const externalId = getRecordExternalId(record);
    const hctc = normalize(record.hctc || record.default_code || record["HCTC Item"]);
    const name = normalize(record.odoo_name || record.name || record["Odoo Description"]);

    if (!externalId && !hctc && !name) return;
    if (/product_template/i.test(externalId)) return;

    PRODUCT_MAP[product] = {
      hctc: hctc,
      odoo_external_id: externalId || null,
      name: name || null,
      serial_tracked: !!externalId
    };
    added++;
  });

  return added;
}
function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function downloadText(filename, text, type="text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function isLikelyExcelDateSerial(value) {
  return typeof value === "number" && value >= 20000 && value <= 60000;
}
function excelDateToISO(value) {
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().slice(0, 10);
  }
  if (isLikelyExcelDateSerial(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return value;
    const yyyy = parsed.y;
    const mm = String(parsed.m).padStart(2, "0");
    const dd = String(parsed.d).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return value;
}
function normalizeHeaderName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function headerMatches(cell, names) {
  const normalizedCell = normalizeHeaderName(cell);
  return names.some(name => normalizedCell === normalizeHeaderName(name));
}
function findHeaderRow(rawRows) {
  const headerGroups = [
    ["Sales Order Num", "Sales Order Number", "Sale Order Number", "Calix Sales Order Number", "Calix Sale Order Number", "Sales Order", "Sale Order", "Order Number", "Order", "SO Number", "SO"],
    ["Serial Number", "Serial", "Calix Serial Number"],
    ["FSAN", "FSAN Number", "FSAN Serial", "Name"],
    ["MAC Address", "MAC"],
    ["Product", "Calix Product", "Calix Product Number"],
    ["Description", "Product Description"],
    ["Actual Ship Date", "Ship Date"],
    ["Customer PO", "PO", "Customer P/O"]
  ];

  let best = { index: -1, score: 0 };
  rawRows.forEach((row, index) => {
    const score = headerGroups.reduce((count, group) => {
      return count + (row.some(cell => headerMatches(cell, group)) ? 1 : 0);
    }, 0);
    if (score > best.score) best = { index, score };
  });

  return best.score >= 3 ? best.index : -1;
}
function rowsToObjects(rawRows, headerRowIndex) {
  const headers = rawRows[headerRowIndex].map(h => normalize(h));
  const dataRows = rawRows.slice(headerRowIndex + 1);

  return dataRows
    .filter(row => row.some(cell => normalize(cell)))
    .map(row => {
      const obj = {};
      headers.forEach((header, index) => {
        if (!header) return;
        let value = row[index] ?? "";
        if (/date/i.test(header)) value = excelDateToISO(value);
        obj[header] = value;
      });
      return obj;
    });
}
function readWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const lowerName = file.name.toLowerCase();
        let wb;
        if (lowerName.endsWith(".csv")) {
          wb = XLSX.read(e.target.result, { type: "string", cellDates: false });
        } else {
          const data = new Uint8Array(e.target.result);
          wb = XLSX.read(data, { type: "array", cellDates: false });
        }

        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        const headerRowIndex = findHeaderRow(rawRows);

        if (headerRowIndex === -1) {
          throw new Error("Could not find a valid header row. Expected columns like Sales Order, Serial Number, FSAN, MAC Address, Product, or Ship Date.");
        }

        resolve(rowsToObjects(rawRows, headerRowIndex));
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}
function readWorkbookRawRows(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const lowerName = file.name.toLowerCase();
        let wb;
        if (lowerName.endsWith(".csv")) {
          wb = XLSX.read(e.target.result, { type: "string", cellDates: false });
        } else {
          const data = new Uint8Array(e.target.result);
          wb = XLSX.read(data, { type: "array", cellDates: false });
        }

        const ws = wb.Sheets[wb.SheetNames[0]];
        const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
        resolve(rawRows);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    if (file.name.toLowerCase().endsWith(".csv")) reader.readAsText(file);
    else reader.readAsArrayBuffer(file);
  });
}
function isLikelyRmaHeader(row, nextRow) {
  const a = normalize(row?.[0]);
  const b = normalize(row?.[1]);
  const nextA = normalize(nextRow?.[0]);
  const nextB = normalize(nextRow?.[1]);
  if (!a) return false;
  return /\bRMA\b/i.test(b);
}
function cleanRmaNumber(value) {
  let cleaned = normalize(value).replace(/^RMA\b\s*[:#-]?\s*/i, "").trim();
  if (!cleaned || /^[?\s]+$/.test(cleaned)) return "null";
  return cleaned;
}
function parseRmaRows(rawRows) {
  const rows = [];
  let currentItem = "";
  let currentRma = "";

  rawRows.forEach((row, index) => {
    const colA = normalize(row?.[0]);
    const colB = normalize(row?.[1]);
    const nextRow = rawRows[index + 1] || [];

    if (isLikelyRmaHeader(row, nextRow)) {
      currentItem = colA;
      currentRma = cleanRmaNumber(colB);
      return;
    }

    if (!currentItem) return;
    if (!colA && !colB) return;

    rows.push({
      row_number: index + 1,
      source_type: "rma",
      rma_number: currentRma,
      Product: currentItem,
      "Serial Number": colA,
      FSAN: colB
    });
  });

  if (!rows.length) {
    throw new Error("No RMA serial rows found. Expected item/RMA header rows followed by serial/CXNK rows in columns A and B.");
  }

  return rows;
}
async function readRmaWorkbook(file) {
  return parseRmaRows(await readWorkbookRawRows(file));
}
async function readSourceWorkbook(file) {
  const rawRows = await readWorkbookRawRows(file);
  const headerRowIndex = findHeaderRow(rawRows);
  if (headerRowIndex !== -1) {
    return { rows: rowsToObjects(rawRows, headerRowIndex), type: "Calix spreadsheet" };
  }
  return { rows: parseRmaRows(rawRows), type: "RMA spreadsheet" };
}
function setDropState(dropId, statusId, loaded, message) {
  const drop = $(dropId);
  const status = $(statusId);
  if (!drop || !status) return;
  drop.classList.toggle("loaded", !!loaded);
  drop.classList.toggle("ready", !loaded);
  status.textContent = message;
  updateClearBtns();
}

function buildIndexes(records) {
  return {
    fsan: new Set(records.map(r => normKey(r.fsan || r.name)).filter(Boolean)),
    serial: new Set(records.map(r => normKey(r.serial || r.ref)).filter(Boolean)),
    mac: new Set(records.map(r => normKey(getRecordMac(r))).filter(Boolean))
  };
}

function buildHistorySerialIndex(records) {
  const index = new Map();
  (records || []).forEach((record, idx) => {
    const key = normKey(record.serial || record.ref);
    if (key && !index.has(key)) index.set(key, { record, idx });
  });
  return index;
}
const MERGE_FIELDS = [
  "sale_order",
  "customer_po",
  "ship_date",
  "calix_product",
  "calix_description",
  "hctc",
  "odoo_external_id",
  "odoo_name",
  "serial",
  "fsan",
  "mac_address"
];
function previewMerge(existing, incoming) {
  const fillable = [];
  const conflicts = [];

  MERGE_FIELDS.forEach(key => {
    const oldVal = normalize(existing[key]);
    const newVal = normalize(incoming[key]);

    if (!oldVal && newVal) {
      fillable.push(key);
    } else if (oldVal && newVal && oldVal !== newVal) {
      conflicts.push(`${key}: history="${oldVal}" import="${newVal}"`);
    }
  });

  return { fillable, conflicts };
}
function mergeMissingFields(existing, incoming) {
  const merged = { ...existing };
  MERGE_FIELDS.forEach(key => {
    const oldVal = normalize(merged[key]);
    const newVal = normalize(incoming[key]);
    if (!oldVal && newVal) merged[key] = newVal;
  });
  return merged;
}
function processRows(rows) {
  lastLoadedRows = rows;
  const histIdx = buildIndexes(history.records || []);
  const histBySerial = buildHistorySerialIndex(history.records || []);
  const seen = { fsan: new Map(), serial: new Map(), mac: new Map() };
  currentBatch = rows.map((row, i) => {
    const sourceType = getField(row, ["source_type"]);
    const rmaNumber = getField(row, ["RMA Number", "RMA", "rma_number"]);
    const saleOrder = getField(row, ["Sales Order Num", "Sales Order Number", "Sale Order Number", "Calix Sales Order Number", "Calix Sale Order Number", "Sales Order", "Sale Order", "sale_order", "Order Number", "Order", "SO Number", "SO"]);
    const customerPo = getField(row, ["Customer PO", "PO", "Customer P/O", "customer_po"]);
    const shipDate = getField(row, ["Actual Ship Date", "Ship Date", "ship_date"]);
    const sourceProduct = getField(row, ["Product", "Calix Product", "Calix Product Number", "calix_product"]);
    const calixDescription = getField(row, ["Description", "Product Description", "calix_description"]);
    const serial = sanitizeScannerValue(getField(row, ["Serial Number", "Serial", "Calix Serial Number", "serial"]), { uppercase: true });
    const fsan = sanitizeScannerValue(getField(row, ["FSAN", "fsan", "FSAN Number", "FSAN Serial", "name"]), { uppercase: true });
    const mac = sanitizeScannerValue(getField(row, ["MAC Address", "MAC", "mac", "MAC address"]), { uppercase: true });
    const mapMatch = findProductMapMatch(sourceProduct);
    const map = mapMatch?.entry || null;
    const calixProduct = resolveCalixProduct(sourceProduct, mapMatch);
    let status = "valid";
    let messages = [];

    const fsanKey = normKey(fsan), serialKey = normKey(serial), macKey = normKey(mac);
    let odooNameValue = fsan;

    if (!map) {
      status = "blocked";
      messages.push("no_match: product is not in product map");
    }
    else if (!map.serial_tracked || mapHistoryOnly(map)) { status = "dni"; messages.push(mapHistoryOnly(map) ? "DNI: product is history-only by default" : "DNI: valid product, not serial-tracked in Odoo"); }
    else {
      const validation = validateProductMapEntry(map);
      if (!validation.ok) { status = "blocked"; messages.push(validation.message); }
    }

    if (!fsanKey) {
      if (map && mapRequiresFsan(map)) {
        status = "blocked"; messages.push("missing FSAN/name required for this product");
      } else if (serialKey && map && getMapExternalId(map) && map.serial_tracked) {
        odooNameValue = serial;
        messages.push("non-FSAN import: using Serial Number as Odoo name; Odoo ref will be blank");
      } else {
        status = "blocked"; messages.push("missing FSAN/name");
      }
    }
    if (!serialKey) { status = "blocked"; messages.push("missing Calix serial/ref"); }
    const candidateRecord = {
      row_number: row.row_number || i + 2,
      source_type: sourceType,
      rma_number: rmaNumber,
      vendor: getMapVendor(map),
      sale_order: saleOrder,
      customer_po: customerPo,
      ship_date: shipDate,
      calix_product: calixProduct,
      calix_description: calixDescription,
      hctc: map?.hctc || sourceProduct || "",
      odoo_external_id: getMapExternalId(map),
      external_id: getMapExternalId(map),
      odoo_name: getMapDescription(map),
      serial_tracked: !!map?.serial_tracked,
      requires_fsan: !!mapRequiresFsan(map),
      history_only: !!mapHistoryOnly(map),
      serial,
      fsan: odooNameValue,
      original_fsan: fsan,
      mac_address: mac,
      mac
    };

    const scanWarnings = getField(row, ["scan_warnings"]);
    if (scanWarnings) messages.push(scanWarnings);

    if (getField(row, ["blind_history_only"]).toLowerCase() === "yes") {
      status = "dni";
      messages.push("DNI: manually marked history-only");
    }

    if (sourceType === "rma" && ((fsanKey && histIdx.fsan.has(fsanKey)) || (serialKey && histIdx.serial.has(serialKey)))) {
      status = "history_only";
      messages.push("Duplicate; no import");
    }

    if (sourceType !== "rma" && fsanKey && histIdx.fsan.has(fsanKey)) {
      const existingForSerial = serialKey ? histBySerial.get(serialKey)?.record : null;
      const existingFsan = normKey(existingForSerial?.fsan || existingForSerial?.name);
      if (!existingForSerial || existingFsan !== fsanKey) {
        status = "blocked";
        messages.push("duplicate FSAN in history");
      }
    }
    if (sourceType !== "rma" && serialKey && histIdx.serial.has(serialKey)) {
      const existingHit = histBySerial.get(serialKey);
      if (existingHit && status !== "blocked") {
        const mergePreview = previewMerge(existingHit.record, candidateRecord);
        if (mergePreview.conflicts.length) {
          status = "blocked";
          messages.push("duplicate serial in history; merge conflict: " + mergePreview.conflicts.join(" | "));
        } else if (mergePreview.fillable.length) {
          status = "merge_candidate";
          messages.push("duplicate serial in history; merge can fill: " + mergePreview.fillable.join(", "));
        } else {
          status = "history_only";
          messages.push("duplicate serial in history; no missing fields to merge");
        }
      } else {
        status = "blocked";
        messages.push("duplicate serial in history");
      }
    }
    if (fsanKey && seen.fsan.has(fsanKey)) { status = "blocked"; messages.push("duplicate FSAN in current file"); }
    if (serialKey && seen.serial.has(serialKey)) { status = "blocked"; messages.push("duplicate serial in current file"); }
    if (macKey && histIdx.mac.has(macKey)) messages.push("warning: MAC is a duplicate");
    if (macKey && seen.mac.has(macKey)) messages.push("warning: duplicate MAC in current file");
    collectPatternWarnings({ product: sourceProduct, map, serial, fsan, mac }).forEach(w => messages.push(w));
    if (fsanKey) seen.fsan.set(fsanKey, i);
    if (serialKey) seen.serial.set(serialKey, i);
    if (macKey) seen.mac.set(macKey, i);

    return {
      ...candidateRecord,
      status,
      messages: messages.join("; ")
    };
  });
  importedPending = false;
  lastExportRows = [];
  renderAll();
  scheduleBatchDraftSave();
}
function renderSummary() {
  const total = currentBatch.length;
  const valid = currentBatch.filter(r => r.status === "valid").length;
  const dni = currentBatch.filter(r => r.status === "dni").length;
  const historyOnly = currentBatch.filter(r => r.status === "history_only").length;
  const merge = currentBatch.filter(r => r.status === "merge_candidate").length;
  const blocked = currentBatch.filter(r => r.status === "blocked").length;
  const warnings = currentBatch.filter(r => /warning/i.test(r.messages)).length;
  const s = (n, label, cls) =>
    `<div class="stat-item${cls ? " " + cls : ""}"><span class="stat-num">${n}</span><span class="stat-label">${label}</span></div>`;
  $("summary").innerHTML =
    s(total, "Rows") +
    s(valid, "Exportable") +
    s(dni, "DNI") +
    s(historyOnly, "Hist. Only") +
    s(merge, "Mergeable") +
    s(blocked, "Blocked", blocked > 0 ? "is-blocked" : "") +
    s(warnings, "Warnings", warnings > 0 ? "is-warn" : "");
  $("exportCsvBtn").disabled = !(valid > 0 && blocked === 0);
  $("markImportedBtn").disabled = !importedPending;
  $("appendHistoryOnlyBtn").disabled = currentBatch.length === 0;
  $("mergeExistingBtn").disabled = merge === 0;
  $("exportBlockedBtn").disabled = blocked === 0;
  $("excludeBlockedBtn").disabled = blocked === 0;
}
function renderBatch() {
  const cols = ["status","messages","row_number","source_type","rma_number","vendor","sale_order","customer_po","ship_date","calix_product","calix_description","hctc","odoo_external_id","odoo_name","serial","fsan","mac_address"];
  const head = `<tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
  const body = currentBatch.map(r => {
    const cls = r.status === "valid" ? "ok" : r.status === "dni" ? "dni" : r.status === "merge_candidate" ? "merge" : r.status === "history_only" ? "warn" : "block";
    return `<tr class="${cls}">${cols.map(c => c === "status" ? `<td><span class="pill ${cls}">${r[c]}</span></td>` : `<td>${escapeHtml(r[c])}</td>`).join("")}</tr>`;
  }).join("");
  $("batchTable").innerHTML = head + body;
}
function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch]));
}
function renderHistory(records = history.records || []) {
  const cols = ["imported_at","source_type","rma_number","vendor","sale_order","customer_po","ship_date","calix_product","hctc","odoo_external_id","serial","fsan","mac_address","status"];
  const head = `<tr>${cols.map(c => `<th>${c}</th>`).join("")}</tr>`;
  const body = records.slice().reverse().slice(0, 500).map(r => `<tr>${cols.map(c => `<td>${escapeHtml(r[c])}</td>`).join("")}</tr>`).join("");
  $("historyTable").innerHTML = head + body;
}
function renderUnknownProducts() {
  const unknowns = new Map();
  currentBatch.forEach(r => {
    if (r.messages && r.messages.indexOf("no_match") >= 0) {
      if (!unknowns.has(r.calix_product)) {
        unknowns.set(r.calix_product, {
          calix_product: r.calix_product,
          calix_description: r.calix_description,
          count: 0
        });
      }
      unknowns.get(r.calix_product).count += 1;
    }
  });

  const rows = Array.from(unknowns.values());
  const head = "<tr><th>Product</th><th>Description</th><th>Rows</th><th>Action</th></tr>";
  const body = rows.map(r => "<tr>" +
    "<td>" + escapeHtml(r.calix_product) + "</td>" +
    "<td>" + escapeHtml(r.calix_description) + "</td>" +
    "<td>" + r.count + "</td>" +
    "<td><button class='secondary' onclick='prefillMapping(" + JSON.stringify(r.calix_product) + ", " + JSON.stringify(r.calix_description) + ")'>Map This</button></td>" +
    "</tr>").join("");
  $("unknownProductsTable").innerHTML = head + body;
}
function renderAll() { renderSummary(); renderBatch(); renderHistory(); renderUnknownProducts(); }

async function loadJsonFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    loadSourceData(JSON.parse(text), file.name);
  } catch (err) {
    alert("Could not load JSON: " + err.message);
  }
}

function loadSourceData(parsed, fileName = "selected JSON") {
  let loadedProductMap = PRODUCT_MAP;
  let loadedHistory = { records: [] };

  if (Array.isArray(parsed)) {
    loadedHistory = { records: parsed };
  } else if (parsed && typeof parsed === "object") {
    if (parsed.product_map && typeof parsed.product_map === "object") {
      loadedProductMap = parsed.product_map;
    }

    if (parsed.history && typeof parsed.history === "object") {
      loadedHistory = parsed.history;
    } else if (Array.isArray(parsed.records)) {
      loadedHistory = { records: parsed.records };
    } else {
      loadedHistory = { records: [] };
    }
  } else {
    throw new Error("JSON root must be an object or an array.");
  }

  if (!Array.isArray(loadedHistory.records)) loadedHistory.records = [];

  loadedHistory.records = loadedHistory.records.map(record => ({
    ...record,
    odoo_external_id: getRecordExternalId(record) || record.odoo_external_id || "",
    mac_address: getRecordMac(record) || record.mac_address || ""
  }));
  Object.values(loadedProductMap || {}).forEach(entry => {
    if (entry && entry.external_id && !entry.odoo_external_id) entry.odoo_external_id = entry.external_id;
  });

  PRODUCT_MAP = loadedProductMap;
  history = loadedHistory;
  appData.product_map = PRODUCT_MAP;
  appData.history = history;

  if (Array.isArray(parsed.inventory_sessions)) appData.inventory_sessions = parsed.inventory_sessions;
  if (Array.isArray(parsed.inventory_events))   appData.inventory_events   = parsed.inventory_events;
  if (Array.isArray(parsed.odoo_quants) && parsed.odoo_quants.length) {
    appData.odoo_quants = parsed.odoo_quants;
    invQuantsBaseline = parsed.odoo_quants;
    invRenderQuantsBaselineStatus();
  }
  if (Array.isArray(parsed.recount_sessions))  appData.recount_sessions  = parsed.recount_sessions;
  if (Array.isArray(parsed.recount_movements)) appData.recount_movements = parsed.recount_movements;
  if (parsed.recount_sessions || parsed.recount_movements) rcLoadFromAppData();
  if (parsed.barcode_map && typeof parsed.barcode_map === "object") {
    Object.assign(BARCODE_MAP, parsed.barcode_map);
    appData.barcode_map = BARCODE_MAP;
    bcSaveBarcodeMapToStorage();
  }

  const inferredMapCount = inferProductMapFromHistory(history.records);
  const blockedTemplateMapCount = countBlockedTemplateMappings(PRODUCT_MAP);
  appData.product_map = PRODUCT_MAP;

  $("mapPreview").value = JSON.stringify(PRODUCT_MAP, null, 2);
  setDropState("historyDropZone", "historyDropStatus", true, `Loaded: ${fileName}`);
  $("historyStatus").textContent = `${history.records.length} records loaded.` + (inferredMapCount ? ` ${inferredMapCount} mappings inferred.` : "") + (blockedTemplateMapCount ? ` ⚠ ${blockedTemplateMapCount} template ID(s) blocked.` : "");
  updateSidebarStatus(1, history.records.length);

  if (lastLoadedRows.length) processRows(lastLoadedRows);
  else renderAll();
  prodRenderList();
  checkReelItemConflicts();
  timSaveMasterCache();
}

// Per-card file inputs removed — universal drop zone handles all routing.

async function loadSourceFile(file) {
  if (!file) return;
  try {
    const parsed = await readSourceWorkbook(file);
    processRows(parsed.rows);
    setDropState("sourceDropZone", "sourceDropStatus", true, `Loaded: ${file.name} (${parsed.type})`);
    updateSidebarStatus(2, parsed.rows.length - 1); // subtract header row
  } catch (err) {
    setDropState("sourceDropZone", "sourceDropStatus", false, "Waiting for upload");
    updateSidebarStatus(2, null);
    alert("Could not parse source file: " + err.message);
  }
}
// ═══════════════════════════════════════════════════════════════════════
// UNIVERSAL SMART DROP ZONE
// Detects import type by file extension + header column signatures.
// ═══════════════════════════════════════════════════════════════════════

function _universalDetectToast(msg, state) {
  var el = $("universalDropStatus");
  if (!el) return;
  el.textContent = msg;
  el.className = state || "";
}

// ── CSV Column Mapper ────────────────────────────────────────────────────────

function _parseCsvToRowObjects(text) {
  var lines = text.split(/\r?\n/);
  if (!lines.length) return [];
  var header = bcParseCsvRow(lines[0] || "");
  var rows = [];
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var cells = bcParseCsvRow(line);
    var row = {};
    header.forEach(function(h, idx) { if (h) row[h] = cells[idx] || ""; });
    rows.push(row);
  }
  return rows;
}

var _CSV_IMPORT_TYPES = [
  {
    id: "receiving",
    label: "Receiving Source File",
    desc: "Calix shipment / RMA — serials, FSANs, product model",
    fields: [
      { key: "FSAN",           label: "FSAN / ONT Serial #",     required: true  },
      { key: "Serial Number",  label: "Calix Factory Serial",    required: false },
      { key: "Product",        label: "Product / Model #",       required: false },
      { key: "Sales Order Num",label: "Sales Order #",           required: false },
      { key: "Customer PO",    label: "Customer PO / Item #",    required: false },
      { key: "Actual Ship Date",label: "Ship Date",              required: false }
    ],
    run: function(text, name) {
      var rows = _parseCsvToRowObjects(text);
      if (!rows.length) throw new Error("No data rows found.");
      processRows(rows);
      setDropState("sourceDropZone", "sourceDropStatus", true,
        "Loaded via column mapper: " + name + " (" + rows.length + " rows)");
      updateSidebarStatus(2, rows.length);
    }
  },
  {
    id: "barcode_sync",
    label: "Barcode Sync",
    desc: "Map product codes to barcodes / serial numbers",
    fields: [
      { key: "default_code",              label: "Product Code / SKU",      required: true  },
      { key: "template_multi_barcode_ids",label: "Barcode / Serial #",      required: true  },
      { key: "id",                        label: "Odoo External ID",         required: false }
    ],
    run: function(text, name) { bcProcessOdooImport(text, name); }
  },
  {
    id: "quants_baseline",
    label: "Quants Baseline",
    desc: "Odoo stock quants — inventory snapshot",
    fields: [
      { key: "id",           label: "Quant ID",           required: true  },
      { key: "product_id",   label: "Product",            required: true  },
      { key: "location_id",  label: "Location",           required: true  },
      { key: "quantity",     label: "Quantity",           required: true  },
      { key: "product_id/id",label: "Product Ext. ID",   required: false },
      { key: "lot_id",       label: "Lot / Serial #",     required: false }
    ],
    run: function(text, name) { invProcessQuantsBaselineCsv(text, name); }
  },
  {
    id: "location_map",
    label: "Location Map",
    desc: "Odoo warehouse locations with barcodes",
    fields: [
      { key: "name",          label: "Location Name",    required: true  },
      { key: "barcode",       label: "Location Barcode", required: true  },
      { key: "location_id",   label: "Parent Location",  required: false },
      { key: "complete_name", label: "Full Path",        required: false }
    ],
    run: function(text, name) { invProcessLocationMapCsv(text, name); }
  },
  {
    id: "inv_adj_sync",
    label: "Inv. Adj. Sync",
    desc: "Odoo inventory adjustments for quantity sync",
    fields: [
      { key: "id",                        label: "Quant ID",         required: true  },
      { key: "product_id/default_code",   label: "Product Code / SKU", required: true },
      { key: "quantity",                  label: "Quantity",         required: true  },
      { key: "location_id/barcode",       label: "Location Barcode", required: false },
      { key: "location_id/complete_name", label: "Location Name",    required: false },
      { key: "lot_id/name",               label: "Lot / Serial #",   required: false }
    ],
    run: function(text, name) { invProcessOdooQuantCsv(text, name); }
  },
  {
    id: "prod_catalog",
    label: "Product Catalog",
    desc: "Add or update products in TIM's catalog",
    fields: [
      { key: "default_code",  label: "NISC Item # / Internal Ref",    required: true  },
      { key: "vendor part #", label: "Vendor Part #",                 required: false },
      { key: "name",          label: "Product Name",                  required: false },
      { key: "tracking",      label: "Tracking (lot / serial / none)",required: false }
    ],
    run: function(text, name) { prodBulkUpload(new File([text], name, { type: "text/csv" })); }
  }
];

var _csvMapperFile  = null;
var _csvMapperCols  = null;

function _csvEsc(s) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function _showCsvMapperModal(file, cols) {
  _csvMapperFile = file;
  _csvMapperCols = cols;
  var modal = $("csvMapperModal");
  if (!modal) return;

  var pillsHtml = cols.map(function(c) {
    return '<span class="csv-col-pill">' + _csvEsc(c) + '</span>';
  }).join(" ");

  var typeCardsHtml = _CSV_IMPORT_TYPES.map(function(t) {
    return '<label class="csv-type-card">' +
      '<input type="radio" name="csvImportType" value="' + _csvEsc(t.id) + '">' +
      '<span class="csv-type-label">' + _csvEsc(t.label) + '</span>' +
      '<span class="csv-type-desc">' + _csvEsc(t.desc) + '</span>' +
    '</label>';
  }).join("");

  modal.innerHTML =
    '<div class="modal" style="max-width:680px;">' +
      '<div class="modal-header">' +
        '<div>' +
          '<h2 style="margin:0;">Identify This CSV</h2>' +
          '<div class="small">TIM couldn\'t auto-detect this file. Select the data type and map your columns.</div>' +
        '</div>' +
        '<button class="secondary" id="csvMapperCloseBtn">Close</button>' +
      '</div>' +
      '<div class="modal-body">' +
        '<p class="small" style="margin:0 0 10px;"><strong>Detected columns:</strong> ' + pillsHtml + '</p>' +
        '<p class="small" style="margin:0 0 8px;font-weight:700;">Step 1 — What type of data is this?</p>' +
        '<div class="csv-type-grid">' + typeCardsHtml + '</div>' +
        '<div id="csvMapperFields" class="hidden" style="margin-top:16px;">' +
          '<p class="small" style="margin:0 0 8px;font-weight:700;">Step 2 — Map your columns</p>' +
          '<p class="small" style="margin:0 0 10px;color:#64748b;">For each TIM field, choose the matching column from your file. Required fields (<span style="color:#ef4444;">*</span>) must be mapped.</p>' +
          '<table class="csv-map-table" id="csvMapTable"></table>' +
          '<div style="margin-top:16px;display:flex;align-items:center;gap:12px;">' +
            '<button id="csvMapperImportBtn">Import</button>' +
            '<span id="csvMapperErr" class="small" style="color:#ef4444;"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  modal.querySelector("#csvMapperCloseBtn").addEventListener("click", function() {
    modal.classList.add("hidden");
  });
  modal.addEventListener("click", function(e) {
    if (e.target === modal) modal.classList.add("hidden");
  });
  modal.querySelectorAll('input[name="csvImportType"]').forEach(function(r) {
    r.addEventListener("change", function() { _csvMapperBuildFields(cols, this.value); });
  });
  modal.querySelector("#csvMapperImportBtn").addEventListener("click", _csvMapperDoImport);

  modal.classList.remove("hidden");
}

function _csvMapperBuildFields(cols, typeId) {
  var type = _CSV_IMPORT_TYPES.find(function(t) { return t.id === typeId; });
  if (!type) return;

  var rows = type.fields.map(function(f) {
    var autoVal = cols.find(function(c) { return c.toLowerCase() === f.key.toLowerCase(); }) || "";
    var options = (f.required
      ? '<option value="">— select a column —</option>'
      : '<option value="">(skip)</option>'
    ) + cols.map(function(c) {
      var sel = (c.toLowerCase() === autoVal.toLowerCase() && autoVal) ? ' selected' : '';
      return '<option value="' + _csvEsc(c) + '"' + sel + '>' + _csvEsc(c) + '</option>';
    }).join("");

    return '<tr>' +
      '<td style="padding:6px 16px 6px 0;font-size:13px;font-weight:700;white-space:nowrap;vertical-align:middle;">' +
        (f.required ? '<span style="color:#ef4444;">* </span>' : '') +
        _csvEsc(f.label) +
        '<div style="font-size:11px;font-weight:400;color:#94a3b8;font-family:monospace;">' + _csvEsc(f.key) + '</div>' +
      '</td>' +
      '<td style="padding:6px 0;vertical-align:middle;">' +
        '<select data-field-key="' + _csvEsc(f.key) + '" data-required="' + f.required + '" ' +
          'style="width:100%;padding:7px 9px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;">' +
          options +
        '</select>' +
      '</td>' +
    '</tr>';
  }).join("");

  var table = $("csvMapTable");
  if (table) table.innerHTML = '<colgroup><col style="width:260px"><col></colgroup>' + rows;
  var fieldsDiv = $("csvMapperFields");
  if (fieldsDiv) fieldsDiv.classList.remove("hidden");
}

function _csvMapperDoImport() {
  var modal = $("csvMapperModal");
  var errEl = $("csvMapperErr");
  if (errEl) errEl.textContent = "";

  var typeRadio = modal.querySelector('input[name="csvImportType"]:checked');
  if (!typeRadio) { if (errEl) errEl.textContent = "Select a data type first."; return; }
  var type = _CSV_IMPORT_TYPES.find(function(t) { return t.id === typeRadio.value; });
  if (!type) return;

  var mapping = {}, missing = [];
  modal.querySelectorAll('[data-field-key]').forEach(function(sel) {
    var fieldKey   = sel.getAttribute("data-field-key");
    var isRequired = sel.getAttribute("data-required") === "true";
    var csvCol     = sel.value;
    if (!csvCol) { if (isRequired) missing.push(fieldKey); return; }
    mapping[csvCol.toLowerCase()] = fieldKey;
  });

  if (missing.length) {
    if (errEl) errEl.textContent = "Required fields not mapped: " + missing.join(", ");
    return;
  }

  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var rewritten = _remapCsvHeaders(e.target.result, mapping);
      modal.classList.add("hidden");
      _universalDetectToast("Column-mapped import: " + type.label + " — loading…");
      type.run(rewritten, _csvMapperFile.name);
    } catch(err) {
      if (errEl) errEl.textContent = "Error: " + err.message;
    }
  };
  reader.readAsText(_csvMapperFile);
}

function _remapCsvHeaders(text, mapping) {
  var useCrlf = text.indexOf("\r\n") !== -1;
  var lines   = text.split(/\r?\n/);
  if (!lines.length) return text;
  var header    = bcParseCsvRow(lines[0]);
  var newHeader = header.map(function(h) {
    var lower = h.trim().toLowerCase();
    return mapping.hasOwnProperty(lower) ? mapping[lower] : h;
  });
  lines[0] = newHeader.map(function(h) {
    return /[,"\r\n]/.test(h) ? '"' + h.replace(/"/g, '""') + '"' : h;
  }).join(",");
  return lines.join(useCrlf ? "\r\n" : "\n");
}

// ── End CSV Column Mapper ────────────────────────────────────────────────────

async function _readCsvHeaders(file) {
  return new Promise(function(resolve, reject) {
    var slice = file.slice(0, 4096);
    var reader = new FileReader();
    reader.onload = function(e) {
      var firstLine = (e.target.result || "").split(/\r?\n/)[0] || "";
      resolve(bcParseCsvRow(firstLine).map(function(h) { return h.trim().toLowerCase(); }));
    };
    reader.onerror = reject;
    reader.readAsText(slice);
  });
}

function odooFilenameType(filename) {
  // Strip extension, then strip Windows duplicate suffix " (N)", then normalize
  var base = filename.trim()
    .replace(/\.[^.]+$/, "")
    .replace(/\s+\(\d+\)$/, "")
    .toLowerCase()
    .trim();
  if (base === "product variant (product.product)") return "prod_catalog";
  if (base === "inventory locations (stock.location)") return "location_map";
  if (base === "quants (stock.quant)") return "quants_baseline";
  return null;
}

async function detectAndRouteFile(file) {
  if (!file) return;
  var ext = file.name.toLowerCase().split(".").pop();
  var fnType = odooFilenameType(file.name);

  if (ext === "json") {
    _universalDetectToast("Detected: Master Data JSON — loading…");
    await loadJsonFile(file);
    _universalDetectToast("Loaded: " + file.name, "ok");
    return;
  }

  if (ext === "xlsx" || ext === "xls") {
    _universalDetectToast("Reading spreadsheet…");
    try {
      var rawRows = await readWorkbookRawRows(file);
      var firstRow = (rawRows[0] || []).map(function(h) { return String(h || "").toLowerCase().trim(); });
      var isProdCatalog = fnType === "prod_catalog" || firstRow.some(function(h) {
        return h === "vendor part #" || h === "nisc item #" || h === "default_code";
      });
      var isQuantsBaseline = fnType === "quants_baseline" || firstRow.indexOf("product_id/id") !== -1;
      var isOdooQuantSync = firstRow.indexOf("product_id/default_code") !== -1 && firstRow.indexOf("id") !== -1 &&
        (firstRow.indexOf("quantity") !== -1 || firstRow.indexOf("on_hand_quantity") !== -1);
      if (isProdCatalog) {
        _universalDetectToast("Detected: Product Catalog — loading…");
        prodBulkUpload(file);
      } else if (isQuantsBaseline || isOdooQuantSync) {
        var csvText = rawRows.map(function(row) {
          return row.map(function(cell) {
            var s = String(cell == null ? "" : cell);
            if (s.indexOf(",") !== -1 || s.indexOf('"') !== -1 || s.indexOf("\n") !== -1) {
              s = '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          }).join(",");
        }).join("\n");
        if (isQuantsBaseline) {
          _universalDetectToast("Detected: Quants Baseline — loading…");
          invProcessQuantsBaselineCsv(csvText, file.name);
        } else {
          _universalDetectToast("Detected: Odoo Inv. Adj. Sync — loading…");
          invProcessOdooQuantCsv(csvText, file.name);
        }
      } else {
        _universalDetectToast("Detected: Receiving Source File — loading…");
        await loadSourceFile(file);
      }
      _universalDetectToast("Loaded: " + file.name, "ok");
    } catch(err) {
      _universalDetectToast("Error: " + err.message, "err");
      alert("Could not read spreadsheet: " + err.message);
    }
    return;
  }

  if (ext === "csv") {
    try {
      var cols = await _readCsvHeaders(file);
      function has() {
        var names = Array.prototype.slice.call(arguments);
        return names.some(function(n) { return cols.indexOf(n) !== -1; });
      }

      if (has("template_multi_barcode_ids")) {
        _universalDetectToast("Detected: Odoo Barcode Sync — loading…");
        bcImportOdooCsv(file);
        return;
      }
      if (has("sku") && has("reels no")) {
        _universalDetectToast("Detected: Cable Reel CSV — loading…");
        invImportReelsCsv(file);
        return;
      }
      if (fnType === "quants_baseline" || has("product_id/id")) {
        _universalDetectToast("Detected: Quants Baseline — loading…");
        invImportQuantsBaseline(file);
        return;
      }
      if (fnType === "location_map" || (has("barcode") && has("name") && has("location_id") && !has("product_id", "product_id/default_code"))) {
        _universalDetectToast("Detected: Location Map — loading…");
        invImportLocationMapCsv(file);
        return;
      }
      if (has("product_id/default_code") && has("id") && has("quantity", "on_hand_quantity")) {
        _universalDetectToast("Detected: Odoo Inv. Adj. Sync — loading…");
        invImportOdooQuantsCsv(file);
        return;
      }
      if (fnType === "prod_catalog" || has("vendor part #") || has("nisc item #")) {
        _universalDetectToast("Detected: Product Catalog — loading…");
        prodBulkUpload(file);
        return;
      }

      _universalDetectToast("Unrecognized CSV — select type to import.", "err");
      _showCsvMapperModal(file, cols);
    } catch(err) {
      _universalDetectToast("Error reading file.", "err");
      alert("Could not read file: " + err.message);
    }
    return;
  }

  _universalDetectToast("Unsupported file type: ." + ext, "err");
  alert("Unsupported file type: ." + ext);
}

(function() {
  var uFile = $("universalFile");
  var uZone = $("universalDropZone");
  if (uFile) uFile.addEventListener("change", function(e) {
    var f = e.target.files[0];
    if (f) { detectAndRouteFile(f); e.target.value = ""; }
  });
  if (uZone) {
    uZone.addEventListener("dragover", function(e) { e.preventDefault(); uZone.classList.add("dragover"); });
    uZone.addEventListener("dragleave", function() { uZone.classList.remove("dragover"); });
    uZone.addEventListener("drop", function(e) {
      e.preventDefault(); uZone.classList.remove("dragover");
      var f = e.dataTransfer.files[0]; if (f) detectAndRouteFile(f);
    });
  }
})();

$("exportCsvBtn").addEventListener("click", () => {
  const rows = currentBatch.filter(r => r.status === "valid");
  const badRows = rows.filter(r => /product_template/i.test(getRecordExternalId(r)));
  if (badRows.length) {
    alert("Export blocked: " + badRows.length + " row(s) still use Product Template external IDs. Update the mapping with Product Variant external IDs first.");
    return;
  }
  const header = ["Product/External ID","ref","name","x_studio_mac_address","note"];
  const lines = [header.join(",")].concat(rows.map(r => {
    const isNonFsan = !r.original_fsan && r.fsan === r.serial;
    const refValue = isNonFsan ? "" : r.serial;
    const noteValue = r.rma_number || r.sale_order;
    return [getRecordExternalId(r), refValue, r.fsan, getRecordMac(r), noteValue].map(csvEscape).join(",");
  }));
  downloadText(`odoo-device-import-${new Date().toISOString().slice(0,10)}.csv`, lines.join("\n"), "text/csv");
  lastExportRows = rows;
  importedPending = true;
  renderSummary();
});
$("markImportedBtn").addEventListener("click", () => {
  if (!lastExportRows.length) return;
  if (!confirm(`Append ${lastExportRows.length} imported rows to history? Only do this after Odoo accepted the import.`)) return;
  const importedAt = new Date().toISOString();
  const newRecords = lastExportRows.map(r => ({ ...r, imported_at: importedAt, status: "imported" }));
  history.records = (history.records || []).concat(newRecords);
  importedPending = false;
  currentBatch = [];
  lastExportRows = [];
  clearBatchDraft();
  timSaveMasterCache();
  $("historyStatus").textContent = `${history.records.length} history records in memory. Export updated JSON to save it.`;
  renderAll();
  alert("History updated in memory. Click Export Current History JSON to save it.");
});
$("exportHistoryBtn").addEventListener("click", () => {
  appData.product_map = PRODUCT_MAP;
  appData.history = history;
  downloadText("Calix_Odoo_Converter_source_data.json", JSON.stringify(buildExportPayload(), null, 2), "application/json");
});
$("appendHistoryOnlyBtn").addEventListener("click", () => {
  if (!currentBatch.length) return;
  const blocked = currentBatch.filter(r => r.status === "blocked").length;
  const rowsToAdd = currentBatch.filter(r => ["valid", "dni", "history_only"].includes(r.status) && !(r.source_type === "rma" && r.status === "history_only"));
  if (!rowsToAdd.length) return alert("There are no non-blocked rows to add to history. Existing RMA rows are intentionally skipped because they already exist in history.");
  const msg = blocked
    ? "Append " + rowsToAdd.length + " non-blocked rows to history and leave " + blocked + " blocked rows in the batch?"
    : "Append " + rowsToAdd.length + " rows to history without creating an Odoo import?";
  if (!confirm(msg)) return;
  const importedAt = new Date().toISOString();
  history.records = (history.records || []).concat(rowsToAdd.map(r => ({ ...r, imported_at: importedAt, status: r.status === "valid" ? "legacy_history" : r.status })));
  currentBatch = currentBatch.filter(r => r.status === "blocked");
  lastExportRows = [];
  importedPending = false;
  timSaveMasterCache();
  $("historyStatus").textContent = history.records.length + " history records in memory. Export updated JSON to save it.";
  renderAll();
  scheduleBatchDraftSave();
  alert("History updated in memory. Any blocked rows were left in the batch for review.");
});
$("mergeExistingBtn").addEventListener("click", () => {
  const mergeRows = currentBatch.filter(r => r.status === "merge_candidate");
  if (!mergeRows.length) return;

  if (!confirm("Merge missing fields into " + mergeRows.length + " existing history records? Existing populated fields will not be overwritten. Export the JSON afterward to save the changes.")) return;

  const bySerial = buildHistorySerialIndex(history.records || []);
  const now = new Date().toISOString();
  let mergedCount = 0;
  let conflictCount = 0;

  mergeRows.forEach(row => {
    const hit = bySerial.get(normKey(row.serial));
    if (!hit) {
      row.status = "blocked";
      row.messages += "; merge failed: serial was not found in history";
      conflictCount++;
      return;
    }

    const check = previewMerge(hit.record, row);
    if (check.conflicts.length) {
      row.status = "blocked";
      row.messages += "; merge conflict: " + check.conflicts.join(" | ");
      conflictCount++;
      return;
    }

    history.records[hit.idx] = {
      ...mergeMissingFields(hit.record, row),
      updated_at: now,
      merge_source: "Calix blocked row import",
      status: hit.record.status || "legacy_history"
    };
    mergedCount++;
  });

  currentBatch = currentBatch.filter(r => r.status !== "merge_candidate");
  lastExportRows = [];
  importedPending = false;
  $("historyStatus").textContent = history.records.length + " history records in memory. Export updated JSON to save it.";
  renderAll();
  scheduleBatchDraftSave();
  alert("Merged " + mergedCount + " records. " + conflictCount + " rows need review.");
});
$("exportBlockedBtn").addEventListener("click", () => {
  const rows = currentBatch.filter(r => r.status === "blocked");
  if (!rows.length) return;
  const cols = ["row_number","messages","source_type","rma_number","sale_order","customer_po","ship_date","calix_product","calix_description","hctc","odoo_external_id","odoo_name","serial","fsan","mac_address"];
  const lines = [cols.join(",")].concat(rows.map(r => cols.map(c => csvEscape(r[c])).join(",")));
  downloadText("blocked-calix-rows-" + new Date().toISOString().slice(0,10) + ".csv", lines.join("\n"), "text/csv");
});
$("excludeBlockedBtn").addEventListener("click", () => {
  const blocked = currentBatch.filter(r => r.status === "blocked").length;
  if (!blocked) return;
  if (!confirm("Remove " + blocked + " blocked rows from this batch? They will not be exported or added to history.")) return;
  currentBatch = currentBatch.filter(r => r.status !== "blocked");
  renderAll();
  scheduleBatchDraftSave();
});
$("clearBatchBtn").addEventListener("click", () => { currentBatch = []; lastExportRows = []; importedPending = false; renderAll(); clearBatchDraft(); });

function prefillMapping(product, description) {
  $("mapProduct").value = normalize(product);
  $("mapHctc").value = normalize(product);
  $("mapName").value = normalize(description);
  $("mapVendor").value = "";
  $("mapSerialTracked").checked = true;
  $("mapRequiresFsan").checked = false;
  $("mapHistoryOnly").checked = false;
  $("mapExternalId").focus();
}

function runHistorySearch() {
  const q = normKey($("historySearch").value);
  if (!q) return renderHistory();

  const results = (history.records || []).filter(r =>
    Object.values(r).some(v => normKey(v).includes(q))
  );
  renderHistory(results);
}


let searchTimeout;

$("historySearch").addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(runHistorySearch, 150);
});

$("saveMappingBtn").addEventListener("click", () => {
  const product = normalize($("mapProduct").value);
  if (!product) return alert("Product Number is required.");
  const serialTracked = $("mapSerialTracked").checked;
  const externalId = normalize($("mapExternalId").value);
  if (serialTracked && !externalId) return alert("Odoo Product Variant External ID is required for serial-tracked/importable products.");
  if (serialTracked && /product_template/i.test(externalId)) return alert("Blocked: this is a Product Template external ID. Export the External ID from Odoo Product Variants and use the product_product ID instead.");

  const trackingType = normalize($("mapTrackingType").value) || (serialTracked ? "serial" : "none");
  PRODUCT_MAP[product] = {
    hctc: normalize($("mapHctc").value) || product,
    vendor: normalize($("mapVendor").value) || null,
    external_id: externalId || null,
    odoo_external_id: externalId || null,
    name: normalize($("mapName").value) || null,
    description: normalize($("mapName").value) || null,
    tracking_type: trackingType,
    serial_tracked: serialTracked,
    requires_fsan: $("mapRequiresFsan").checked,
    history_only: $("mapHistoryOnly").checked
  };

  appData.product_map = PRODUCT_MAP;
  $("mapPreview").value = JSON.stringify(PRODUCT_MAP, null, 2);
  timSaveMasterCache();

  if (lastLoadedRows.length) processRows(lastLoadedRows);
  alert("Mapping saved. Export the source data JSON when you are ready to keep this change.");
});
$("clearMappingFormBtn").addEventListener("click", () => {
  $("mapProduct").value = "";
  $("mapHctc").value = "";
  $("mapExternalId").value = "";
  $("mapName").value = "";
  $("mapVendor").value = "";
  $("mapTrackingType").value = "serial";
  $("mapSerialTracked").checked = true;
  $("mapRequiresFsan").checked = false;
  $("mapHistoryOnly").checked = false;
});

function getBlindMap() {
  return activeBlindMapMatch?.entry || null;
}
function updateBlindLookup() {
  const item = normalize($("blindHctc").value);
  activeBlindMapMatch = findProductMapMatch(item);
  const panel = $("blindLookupPanel");
  const mappingPanel = $("blindMappingPanel");
  if (!item) {
    panel.textContent = "Enter an HCTC item number to look up the product mapping.";
    mappingPanel.classList.add("hidden");
    return;
  }
  if (activeBlindMapMatch) {
    const map = activeBlindMapMatch.entry;
    panel.innerHTML = "<b>Recognized:</b> " + escapeHtml(getMapDescription(map) || activeBlindMapMatch.key) +
      "<br><b>Vendor:</b> " + escapeHtml(getMapVendor(map) || "Not specified") +
      "<br><b>Odoo External ID:</b> " + escapeHtml(getMapExternalId(map) || "None") +
      "<br><b>Requires FSAN:</b> " + (mapRequiresFsan(map) ? "Yes" : "No") +
      "<br><b>Default behavior:</b> " + (mapHistoryOnly(map) || !map.serial_tracked ? "History only / DNI" : "Odoo importable");
    mappingPanel.classList.add("hidden");
  } else {
    panel.innerHTML = "<b>Unknown item:</b> " + escapeHtml(item) + ". Create a mapping before adding devices for this item.";
    $("blindDescription").value = $("blindDescription").value || "";
    mappingPanel.classList.remove("hidden");
  }
}
function saveBlindMapping() {
  const item = normalize($("blindHctc").value);
  if (!item) return alert("HCTC item number is required.");
  const serialTracked = $("blindSerialTracked").checked;
  const externalId = normalize($("blindExternalId").value);
  if (serialTracked && !$("blindHistoryOnlyDefault").checked && !externalId) return alert("Odoo Product Variant External ID is required for importable items. Check history-only if this should not export to Odoo.");
  if (serialTracked && externalId && /product_template/i.test(externalId)) return alert("Blocked: use the Product Variant external ID, not a Product Template external ID.");
  PRODUCT_MAP[item] = {
    hctc: item,
    vendor: normalize($("blindVendor").value) || "Other",
    external_id: externalId || null,
    odoo_external_id: externalId || null,
    name: normalize($("blindDescription").value) || null,
    description: normalize($("blindDescription").value) || null,
    tracking_type: serialTracked ? "serial" : "none",
    serial_tracked: serialTracked,
    requires_fsan: $("blindRequiresFsan").checked,
    history_only: $("blindHistoryOnlyDefault").checked
  };
  appData.product_map = PRODUCT_MAP;
  $("mapPreview").value = JSON.stringify(PRODUCT_MAP, null, 2);
  updateBlindLookup();
  if (lastLoadedRows.length) processRows(lastLoadedRows);
  alert("Mapping saved. Export the source data JSON later to keep this change.");
}
function clearBlindDeviceFields() {
  ["blindSerial","blindFsan","blindMac"].forEach(id => $(id).value = "");
  blindQueueEditIndex = -1;
  updateBlindPatternHint();
  updateBlindQueueNav();
}
function blindSessionRequiresFsan(map) {
  return !!($("blindRequireFsanForSession").checked || mapRequiresFsan(map));
}
function blindSessionRequiresMac() {
  return !!$("blindRequireMacForSession").checked;
}
function getBlindDeviceValues() {
  return {
    item: sanitizeScannerValue($("blindHctc").value, { uppercase: true }),
    serial: sanitizeScannerValue($("blindSerial").value, { uppercase: true }),
    fsan: sanitizeScannerValue($("blindFsan").value, { uppercase: true }),
    mac: sanitizeScannerValue($("blindMac").value, { uppercase: true }),
    saleOrder: sanitizeScannerValue($("blindSaleOrder").value),
    customerPo: sanitizeScannerValue($("blindCustomerPo").value),
    receiveDate: sanitizeScannerValue($("blindReceiveDate").value),
    notes: sanitizeScannerValue($("blindNotes").value)
  };
}
function updateBlindPatternHint() {
  const values = getBlindDeviceValues();
  const match = findProductMapMatch(values.item);
  const warnings = match ? collectPatternWarnings({ product: values.item, map: match.entry, serial: values.serial, fsan: values.fsan, mac: values.mac }) : [];
  const panel = $("blindPatternHint");
  if (!panel) return;
  panel.classList.toggle("ok", warnings.length === 0);
  panel.innerHTML = warnings.length
    ? "<b>Soft warning:</b> " + formatPatternWarnings(warnings) + "<br><span class='small'>This will not block receiving; it is meant to catch possible bad scans.</span>"
    : "Pattern check OK. Warnings will appear here without blocking the scan.";
}
function renderRecentBlindSerials() {
  const box = $("blindRecentScans");
  if (!box) return;
  box.innerHTML = recentBlindSerials.length
    ? recentBlindSerials.slice(0, 4).map(s => "<span class='recent-scan-pill'>" + escapeHtml(s) + "</span>").join("")
    : "<span class='small'>None yet</span>";
}
function setBlindScanStatus(message) {
  $("blindScanStatus").innerHTML = message;
}

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}
function playBeep(type) {
  try {
    const ctx = getAudioCtx();
    const tones = type === "found"
      ? [{ freq: 880, start: 0, dur: 0.06 }, { freq: 1108, start: 0.09, dur: 0.09 }]
      : [{ freq: 480, start: 0, dur: 0.08 }];
    tones.forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.18, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.02);
    });
  } catch(e) {}
}

function lookupDeviceInHistory(value) {
  if (!value) return null;
  const key = normKey(value);
  return (history.records || []).find(r =>
    (r.serial  && normKey(r.serial)  === key) ||
    (r.ref     && normKey(r.ref)     === key) ||
    (r.fsan    && normKey(r.fsan)    === key)
  ) || null;
}

function prefillBlindFromHistory(record) {
  const fieldMap = {
    blindFsan:       record.fsan        || "",
    blindMac:        record.mac_address || "",
    blindSaleOrder:  record.sale_order  || "",
    blindCustomerPo: record.customer_po || "",
    blindNotes:      record.rma_number  || ""
  };
  const filled = [];
  Object.entries(fieldMap).forEach(([id, val]) => {
    if (val && !$(id).value.trim()) {
      $(id).value = val;
      const label = { blindFsan: "FSAN", blindMac: "MAC", blindSaleOrder: "Sales Order",
                      blindCustomerPo: "Customer PO", blindNotes: "RMA" }[id];
      filled.push(label);
    }
  });
  return filled;
}

function findBlindDuplicateConflict(values, editIndex = -1) {
  const serialKey = normKey(values.serial);
  const fsanKey = normKey(values.fsan);

  if (serialKey) {
    const queuedIndex = blindQueue.findIndex((row, idx) => idx !== editIndex && normKey(row["Serial Number"]) === serialKey);
    if (queuedIndex >= 0) return { field: "serial", where: "scanner queue", detail: "queued device " + (queuedIndex + 1) };

    const batchIndex = currentBatch.findIndex(row => normKey(row.serial || row["Serial Number"]) === serialKey);
    if (batchIndex >= 0) return { field: "serial", where: "current batch", detail: "batch row " + (batchIndex + 1) };

    const historyIndex = (history.records || []).findIndex(row => normKey(row.serial || row.ref || row["Serial Number"]) === serialKey);
    if (historyIndex >= 0) return { field: "serial", where: "history", detail: "history record " + (historyIndex + 1) };
  }

  if (fsanKey) {
    const queuedIndex = blindQueue.findIndex((row, idx) => idx !== editIndex && normKey(row.FSAN || row.fsan || row.name) === fsanKey);
    if (queuedIndex >= 0) return { field: "FSAN", where: "scanner queue", detail: "queued device " + (queuedIndex + 1) };

    const batchIndex = currentBatch.findIndex(row => normKey(row.fsan || row.name || row.FSAN) === fsanKey);
    if (batchIndex >= 0) return { field: "FSAN", where: "current batch", detail: "batch row " + (batchIndex + 1) };

    const historyIndex = (history.records || []).findIndex(row => normKey(row.fsan || row.name || row.FSAN) === fsanKey);
    if (historyIndex >= 0) return { field: "FSAN", where: "history", detail: "history record " + (historyIndex + 1) };
  }

  return null;
}
function assertBlindQueueHasNoDuplicates() {
  const seenSerial = new Map();
  const seenFsan = new Map();

  for (let i = 0; i < blindQueue.length; i++) {
    const row = blindQueue[i];
    const serialKey = normKey(row["Serial Number"]);
    const fsanKey = normKey(row.FSAN || row.fsan || row.name);

    if (serialKey) {
      if (seenSerial.has(serialKey)) {
        return "Duplicate serial in scanner queue: row " + (seenSerial.get(serialKey) + 1) + " and row " + (i + 1) + ".";
      }
      seenSerial.set(serialKey, i);
    }

    if (fsanKey) {
      if (seenFsan.has(fsanKey)) {
        return "Duplicate FSAN in scanner queue: row " + (seenFsan.get(fsanKey) + 1) + " and row " + (i + 1) + ".";
      }
      seenFsan.set(fsanKey, i);
    }
  }

  for (let i = 0; i < blindQueue.length; i++) {
    const row = blindQueue[i];
    const conflict = findBlindDuplicateConflict({
      serial: row["Serial Number"],
      fsan: row.FSAN,
      mac: row["MAC Address"]
    }, i);
    if (conflict) {
      return "Duplicate " + conflict.field + " found before processing queue: row " + (i + 1) + " matches " + conflict.where + " (" + conflict.detail + ").";
    }
  }

  return "";
}

function addBlindDeviceToQueue() {
  const values = getBlindDeviceValues();
  if (!values.item) return alert("HCTC item number is required.");
  const match = findProductMapMatch(values.item);
  if (!match) return alert("This item is not recognized yet. Save the item mapping first.");
  if (!values.serial) return alert("Serial number is required.");
  if (blindSessionRequiresFsan(match.entry) && !values.fsan) return alert("FSAN is required for this product/session.");
  if (blindSessionRequiresMac() && !values.mac) return alert("MAC is required for this scanner session. Uncheck Require MAC if this stack does not have MAC labels available.");

  const duplicateConflict = findBlindDuplicateConflict(values, blindQueueEditIndex);
  if (duplicateConflict) {
    setBlindScanStatus("<b>Duplicate " + escapeHtml(duplicateConflict.field) + " blocked:</b> this value already exists in " + escapeHtml(duplicateConflict.where) + " (" + escapeHtml(duplicateConflict.detail) + "). Fix the scan or edit the existing record.");
    alert("Duplicate " + duplicateConflict.field + " blocked. It already exists in " + duplicateConflict.where + " (" + duplicateConflict.detail + ").");
    $(duplicateConflict.field === "FSAN" ? "blindFsan" : "blindSerial").focus();
    return;
  }

  $("blindHctc").value = values.item;
  $("blindSerial").value = values.serial;
  $("blindFsan").value = values.fsan;
  $("blindMac").value = values.mac;

  const warnings = collectPatternWarnings({ product: values.item, map: match.entry, serial: values.serial, fsan: values.fsan, mac: values.mac });
  const row = {
    source_type: "blind_receiving",
    Product: values.item,
    Description: getMapDescription(match.entry),
    "Serial Number": values.serial,
    FSAN: values.fsan,
    "MAC Address": values.mac,
    "Sales Order Num": values.saleOrder,
    "Customer PO": values.customerPo,
    "Ship Date": values.receiveDate,
    "RMA Number": values.notes,
    scan_warnings: warnings.join("; "),
    blind_history_only: $("blindHistoryOnlyRow").checked ? "yes" : ""
  };

  if (blindQueueEditIndex >= 0 && blindQueueEditIndex < blindQueue.length) {
    blindQueue[blindQueueEditIndex] = row;
    setBlindScanStatus("Updated queued device " + (blindQueueEditIndex + 1) + ".");
  } else {
    blindQueue.push(row);
    recentBlindSerials.unshift(values.serial);
    recentBlindSerials = recentBlindSerials.slice(0, 4);
    setBlindScanStatus("Added serial <b>" + escapeHtml(values.serial) + "</b>. Ready for next serial.");
  }
  ["blindSerial","blindFsan","blindMac"].forEach(id => $(id).value = "");
  blindQueueEditIndex = -1;
  renderRecentBlindSerials();
  renderBlindQueue();
  scheduleBatchDraftSave();
  updateBlindPatternHint();
  setTimeout(() => $("blindSerial").focus(), 25);
}
function loadBlindQueueRow(index) {
  if (index < 0 || index >= blindQueue.length) return;
  const row = blindQueue[index];
  blindQueueEditIndex = index;
  $("blindHctc").value = row.Product || "";
  $("blindSerial").value = row["Serial Number"] || "";
  $("blindFsan").value = row.FSAN || "";
  $("blindMac").value = row["MAC Address"] || "";
  $("blindSaleOrder").value = row["Sales Order Num"] || "";
  $("blindCustomerPo").value = row["Customer PO"] || "";
  $("blindReceiveDate").value = row["Ship Date"] || "";
  $("blindNotes").value = row["RMA Number"] || "";
  $("blindHistoryOnlyRow").checked = String(row.blind_history_only || "").toLowerCase() === "yes";
  updateBlindLookup();
  updateBlindPatternHint();
  renderBlindQueue();
  $("blindSerial").focus();
}
function updateBlindQueueNav() {
  $("blindPrevQueuedBtn").disabled = !(blindQueue.length && blindQueueEditIndex > 0);
  $("blindNextQueuedBtn").disabled = !(blindQueue.length && blindQueueEditIndex >= 0 && blindQueueEditIndex < blindQueue.length - 1);
  $("blindQueueNavStatus").textContent = blindQueueEditIndex >= 0 ? "Editing queued device " + (blindQueueEditIndex + 1) + " of " + blindQueue.length + ". Click Add / Update to save changes." : (blindQueue.length ? blindQueue.length + " queued device(s). New device mode." : "No queued device selected.");
}
function renderBlindQueue() {
  const cols = ["Product","Description","Serial Number","FSAN","MAC Address","scan_warnings","Sales Order Num","Customer PO","Ship Date","RMA Number","blind_history_only"];
  const head = "<tr>" + cols.map(c => "<th>" + escapeHtml(c) + "</th>").join("") + "<th>Action</th></tr>";
  const body = blindQueue.map((r, idx) => "<tr" + (idx === blindQueueEditIndex ? " class='queue-row-selected'" : "") + ">" + cols.map(c => "<td>" + escapeHtml(r[c]) + "</td>").join("") + "<td><button class='secondary' onclick='loadBlindQueueRow(" + idx + ")'>Edit</button><button class='danger' onclick='removeBlindQueueRow(" + idx + ")'>Remove</button></td></tr>").join("");
  $("blindQueueTable").innerHTML = head + body;
  $("blindProcessQueueBtn").disabled = blindQueue.length === 0;
  $("blindClearQueueBtn").disabled = blindQueue.length === 0;
  updateBlindQueueNav();
}
function removeBlindQueueRow(index) {
  blindQueue.splice(index, 1);
  if (blindQueueEditIndex === index) blindQueueEditIndex = -1;
  else if (blindQueueEditIndex > index) blindQueueEditIndex--;
  renderBlindQueue();
  scheduleBatchDraftSave();
}
function processBlindQueue() {
  if (!blindQueue.length) return;
  const duplicateMessage = assertBlindQueueHasNoDuplicates();
  if (duplicateMessage) {
    alert(duplicateMessage);
    setBlindScanStatus("<b>Queue processing blocked:</b> " + escapeHtml(duplicateMessage));
    return;
  }
  const combined = (lastLoadedRows || []).concat(blindQueue.map((r, idx) => ({ ...r, row_number: "manual-" + (idx + 1) })));
  blindQueue = [];
  processRows(combined);
  renderBlindQueue();
  $("blindReceiveModal").classList.add("hidden");
}
$("openBlindReceiveBtn").addEventListener("click", () => {
  $("blindReceiveModal").classList.remove("hidden");
  if (!$("blindReceiveDate").value) $("blindReceiveDate").value = new Date().toISOString().slice(0,10);
  updateBlindLookup();
  renderBlindQueue();
});
$("closeBlindReceiveBtn").addEventListener("click", () => $("blindReceiveModal").classList.add("hidden"));
$("blindHctc").addEventListener("input", () => { $("blindHctc").value = sanitizeScannerValue($("blindHctc").value, { uppercase: true }); updateBlindLookup(); updateBlindPatternHint(); });
$("blindSaveMappingBtn").addEventListener("click", saveBlindMapping);
$("blindAddToQueueBtn").addEventListener("click", addBlindDeviceToQueue);
$("blindClearDeviceBtn").addEventListener("click", clearBlindDeviceFields);
$("blindProcessQueueBtn").addEventListener("click", processBlindQueue);
$("blindClearQueueBtn").addEventListener("click", () => { blindQueue = []; blindQueueEditIndex = -1; renderBlindQueue(); scheduleBatchDraftSave(); });
$("blindFocusSerialBtn").addEventListener("click", () => $("blindSerial").focus());
$("blindNewQueuedBtn").addEventListener("click", clearBlindDeviceFields);
$("blindPrevQueuedBtn").addEventListener("click", () => loadBlindQueueRow(blindQueueEditIndex - 1));
$("blindNextQueuedBtn").addEventListener("click", () => loadBlindQueueRow(blindQueueEditIndex + 1));
["blindSerial","blindFsan","blindMac","blindSaleOrder","blindCustomerPo","blindNotes"].forEach(id => {
  $(id).addEventListener("input", () => {
    const upper = ["blindSerial","blindFsan","blindMac"].includes(id);
    $(id).value = sanitizeScannerValue($(id).value, { uppercase: upper });
    updateBlindPatternHint();
  });
});
function handleScannerEnter(e) {
  if (e.key !== "Enter") return;
  e.preventDefault();
  const field = e.target.id;
  setTimeout(() => {
    const values = getBlindDeviceValues();
    const match = findProductMapMatch(values.item);
    if (!match) { setBlindScanStatus("Save or load a product mapping before scanning devices."); return; }

    if (field === "blindSerial" || field === "blindFsan") {
      const scanValue = field === "blindSerial" ? values.serial : values.fsan;
      const histRecord = lookupDeviceInHistory(scanValue);
      if (histRecord) {
        const filled = prefillBlindFromHistory(histRecord);
        playBeep("found");
        setBlindScanStatus(
          filled.length
            ? "Known device — prefilled: <b>" + filled.join(", ") + "</b>."
            : "Known device found in history."
        );
      }
    }

    if (field === "blindSerial") {
      if (blindSessionRequiresFsan(match.entry) && !$("blindFsan").value.trim()) $("blindFsan").focus();
      else if (blindSessionRequiresMac() && !$("blindMac").value.trim()) $("blindMac").focus();
      else if ($("blindAutoCommit").checked) addBlindDeviceToQueue();
      return;
    }
    if (field === "blindFsan") {
      if (blindSessionRequiresMac() && !$("blindMac").value.trim()) $("blindMac").focus();
      else if ($("blindAutoCommit").checked) addBlindDeviceToQueue();
      return;
    }
    if (field === "blindMac" && $("blindAutoCommit").checked) addBlindDeviceToQueue();
  }, 110);
}
["blindSerial","blindFsan","blindMac"].forEach(id => $(id).addEventListener("keydown", handleScannerEnter));
["blindRequireFsanForSession","blindRequireMacForSession"].forEach(id => $(id).addEventListener("change", () => { updateBlindPatternHint(); $("blindSerial").focus(); }));

renderBlindQueue();
renderAll();
loadBatchDraft();

// Warn before accidental refresh/navigation when batch data is in memory
window.addEventListener("beforeunload", function(e) {
  if (currentBatch.length || blindQueue.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});

// ===================================================================
// UPDATE CHECK
// ===================================================================
async function checkForUpdate() {
  const btn = $("checkUpdateBtn");
  const status = $("updateStatus");
  btn.disabled = true;
  status.style.color = "#64748b";
  status.textContent = "Checking…";

  try {
    // Ask the SW to re-fetch its own script (detects a changed sw.js)
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }

    // Fetch app.js fresh from the network, bypassing SW cache via query string
    const res = await fetch("./app.js?_=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("Network response " + res.status);
    const text = await res.text();

    // Extract version from APP_VERSION constant in fetched file
    const remoteMatch = text.match(/APP_VERSION\s*=\s*"v([\d.]+)"/);
    const localMatch  = APP_VERSION.match(/v([\d.]+)/);
    const remoteVer = remoteMatch ? remoteMatch[1] : null;
    const localVer  = localMatch  ? localMatch[1]  : null;

    if (remoteVer && localVer && remoteVer !== localVer) {
      status.style.color = "#16a34a";
      status.innerHTML = "Update available (v" + remoteVer + "). <a href='#' id='applyUpdateLink' style='color:#2563eb;font-weight:700;'>Reload now</a>";
      $("applyUpdateLink").addEventListener("click", async e => {
        e.preventDefault();
        try {
          // Tell any waiting SW to activate immediately
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
          // Clear SW cache so reload is guaranteed to hit the network
          const cacheNames = await caches.keys();
          await Promise.all(cacheNames.map(n => caches.delete(n)));
        } catch(_) {}
        location.reload();
      });
    } else {
      status.style.color = "#64748b";
      status.textContent = localVer ? "Up to date (v" + localVer + ")" : "Up to date.";
    }
  } catch(err) {
    status.style.color = "#dc2626";
    status.textContent = "Could not reach server. Are you offline?";
  } finally {
    btn.disabled = false;
  }
}

// ===================================================================
// INVENTORY MODE
// ===================================================================

// -- Constants ------------------------------------------------------
const INV_STORAGE_KEY  = "calix_inv_session_v1";
const INV_SCHEMA_VERSION = "1.0";
const TIM_USERNAME_KEY = "tim_username";

function timGetUsername() {
  try { return localStorage.getItem(TIM_USERNAME_KEY) || ""; } catch(e) { return ""; }
}
function timSetUsername(val) {
  val = (val || "").trim();
  try { localStorage.setItem(TIM_USERNAME_KEY, val); } catch(e) {}
  var inp = $("timUsernameInput");
  if (inp) inp.classList.toggle("needs-value", !val);
}
function timInitUsername() {
  var val = timGetUsername();
  var inp = $("timUsernameInput");
  if (inp) { inp.value = val; inp.classList.toggle("needs-value", !val); }
}

// -- Audio feedback -------------------------------------------------
var _timAudioCtx = null;
function _timAudioCtx_get() {
  if (_timAudioCtx && _timAudioCtx.state === "closed") _timAudioCtx = null;
  if (!_timAudioCtx) {
    try { _timAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
  }
  return _timAudioCtx;
}
function timUnlockAudio() {
  var ctx = _timAudioCtx_get();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(function(){});
}
function timBeep(type) {
  var ctx = _timAudioCtx_get();
  if (!ctx) return;
  if (ctx.state === "suspended") { ctx.resume().then(function(){ timBeep(type); }).catch(function(){}); return; }
  var t = ctx.currentTime;
  function tone(freq, dur, vol, shape, delay) {
    delay = delay || 0;
    var osc = ctx.createOscillator(), g = ctx.createGain();
    osc.connect(g); g.connect(ctx.destination);
    osc.type = shape || "sine";
    osc.frequency.setValueAtTime(freq, t + delay);
    g.gain.setValueAtTime(vol, t + delay);
    g.gain.exponentialRampToValueAtTime(0.001, t + delay + dur);
    osc.start(t + delay); osc.stop(t + delay + dur);
  }
  if      (type === "ok")         { tone(880, 0.08, 0.25, "sine"); }
  else if (type === "serialized") { tone(660, 0.07, 0.22, "sine"); tone(990, 0.09, 0.22, "sine", 0.08); }
  else if (type === "reel")       { tone(880, 0.07, 0.22, "sine"); tone(550, 0.10, 0.20, "sine", 0.08); }
  else if (type === "bulk")       { tone(720, 0.10, 0.20, "triangle"); }
  else if (type === "location")   { tone(1100, 0.06, 0.20, "sine"); tone(770, 0.08, 0.18, "sine", 0.07); }
  else if (type === "warn")       { tone(440, 0.12, 0.18, "sine"); }
  else if (type === "error")      { tone(200, 0.06, 0.18, "square", 0); tone(200, 0.06, 0.18, "square", 0.1); }
}

// -- Activity feed --------------------------------------------------
var invActivityLog = [];
var INV_ACTIVITY_MAX = 8;
var _invActivityIcons = { ok:"✓", warn:"⚠", error:"✗", info:"i", location:"⊙", mode:"⇄" };

function invAddActivity(type, message, detail, beepType) {
  timBeep(beepType || type);
  invActivityLog.unshift({ type: type, message: message, detail: detail || "", time: new Date() });
  if (invActivityLog.length > INV_ACTIVITY_MAX) invActivityLog.length = INV_ACTIVITY_MAX;
  renderInvActivityFeed();
}

function invClearActivityFeed() {
  invActivityLog = [];
  renderInvActivityFeed();
}

function renderInvActivityFeed() {
  var list = $("invActivityList");
  if (!list) return;
  if (!invActivityLog.length) {
    list.innerHTML = '<div class="inv-activity-empty">No activity yet. Start a session and scan.</div>';
    return;
  }
  list.innerHTML = invActivityLog.map(function(e, i) {
    var icon = _invActivityIcons[e.type] || "•";
    var ts   = e.time.toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
    return '<div class="inv-activity-entry type-' + e.type + (i === 0 ? " fresh" : "") + '">' +
      '<span class="inv-activity-icon">' + icon + '</span>' +
      '<div class="inv-activity-body">' +
        '<div class="inv-activity-msg">'    + escapeHtml(e.message) + '</div>' +
        (e.detail ? '<div class="inv-activity-detail">' + escapeHtml(e.detail) + '</div>' : '') +
      '</div>' +
      '<span class="inv-activity-time">' + ts + '</span>' +
      '</div>';
  }).join("");
}

// -- State ----------------------------------------------------------
let invSession = null;
let invEvents = [];
var invReelIdConflicts = [];
let invExceptions = [];
let invRecounts = [];
let invSettings = {};
let invSequence = 0;
let invAutosavePending = false;
let invAutosaveTimer = null;
let invTabOpenedOnce = false;
let _invAutoRestoreStarted = false;
let invCurrentLocation = "";
let invNotesModalEventId = null;
let invScanMode = "auto";          // "auto" | "serial" | "reel" | "item"
let invLastBulkEventId = null;     // eventId of most recent bulk_quantity_count
var invOdooQuantMap = {};          // normKey(defCode+"||"+loc+"||"+lot) → { id, onHandQty }
const INV_QUANT_MAP_KEY = "tim_odoo_quant_map_v1";
let invQtyKeypadValue = "1";       // current soft keypad display value
let invQtyKeypadFresh = true;      // true = next digit replaces the default "1"
let invQtyKeypadMode = "qty";      // "qty" | "reel" — routes key presses
let invKeypadTargetEl = null;      // focused reel field in reel mode

// -- Utilities ------------------------------------------------------
function invNow() { return new Date().toISOString(); }

function invFormatTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleTimeString(); } catch(e) { return iso; }
}

function invFormatDateTime(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString(); } catch(e) { return iso; }
}

function invGenerateId(prefix) {
  return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
}

function invGenerateSessionId() {
  var d = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  return "inv_" + d + "_" + String(Date.now()).slice(-4);
}

function invLoadStorageRaw() {
  return TimDB.get(INV_STORAGE_KEY);
}

function invStorageAvailable() {
  return !!window.indexedDB;
}

// -- Tab switching --------------------------------------------------
function switchTab(name) {
  ["dataimport", "receiving", "inventory", "products", "mapping", "barcodes"].forEach(function(t) {
    var panel = $("tab" + t.charAt(0).toUpperCase() + t.slice(1));
    var btn   = $("sideNav" + t.charAt(0).toUpperCase() + t.slice(1));
    if (panel) panel.classList.toggle("active", t === name);
    if (btn)   btn.classList.toggle("active", t === name);
  });
  var invCard = $("sideInvSessionCard");
  if (invCard) invCard.classList.toggle("hidden", name !== "inventory");
  if (name === "inventory" && !invTabOpenedOnce) {
    invTabOpenedOnce = true;
    invShowStorageHint();
    invSetScanMode(invScanMode || "auto");
    rcLoadStorage();
  }
  if (name === "products") prodRenderList();
  if (name === "barcodes") setTimeout(function() { var si = $("bcScanInput"); if (si) si.focus(); }, 50);
  try { localStorage.setItem("tim_active_tab", name); } catch(e) {}
}

// -- Sidebar toggle --------------------------------------------------
function toggleSidebar() {
  var sb = $("appSidebar");
  var collapsed = sb.classList.toggle("collapsed");
  try { localStorage.setItem("tim_sidebar_collapsed", collapsed ? "1" : "0"); } catch(e) {}
}

// -- Sidebar status indicators ---------------------------------------
function updateSidebarStatus(step, rows) {
  var dot   = $("sideStatus" + step + "Dot");
  var count = $("sideStatus" + step + "Count");
  if (!dot || !count) return;
  if (rows !== null && rows >= 0) {
    dot.classList.add("loaded");
    count.classList.add("loaded");
    count.textContent = rows >= 1000 ? (rows / 1000).toFixed(1) + "k" : String(rows);
  } else {
    dot.classList.remove("loaded");
    count.classList.remove("loaded");
    count.textContent = "";
  }
  if (step === 1) {
    var label = $("sideStatus1Label");
    if (label) {
      label.textContent = (rows !== null && rows >= 0)
        ? rows + " history records loaded."
        : "Not loaded — go to Data Import tab.";
    }
  }
}

// -- More dropdown ---------------------------------------------------
function toggleMoreDropdown(e) {
  if (e) e.stopPropagation();
  $("moreDropMenu").classList.toggle("hidden");
}
document.addEventListener("click", function() {
  var m = $("moreDropMenu");
  if (m) m.classList.add("hidden");
  ["invExportSummaryMenu","invExportAdjMenu","invExportEventLogMenu"].forEach(function(id) {
    var el = $(id); if (el) el.classList.add("hidden");
  });
});

// -- Collapsible cards -----------------------------------------------
function toggleCollapsible(bodyId, headerId, chevronId) {
  var body    = $(bodyId);
  var header  = $(headerId);
  var chevron = $(chevronId);
  if (!body) return;
  var open = body.style.display === "none" || body.style.display === "";
  body.style.display = open ? "block" : "none";
  if (header)  header.classList.toggle("open", open);
  if (chevron) chevron.style.transform = open ? "rotate(180deg)" : "";
}

function invShowStorageHint() {
  if (invSession || _invAutoRestoreStarted) return;
  var bar = $("invAutosaveBar");
  if (!bar) return;
  if (!invStorageAvailable()) {
    bar.classList.remove("hidden");
    bar.classList.add("unsaved");
    $("invAutosaveText").textContent =
      "Note: IndexedDB is not available here (sandboxed or private mode). " +
      "Sessions will be in-memory only. Use Export Session Backup JSON to save your work.";
    return;
  }
  TimDB.get(INV_STORAGE_KEY).then(function(saved) {
    if (saved && saved.session) {
      var sessionLabel = saved.session.sessionName || saved.session.sessionId;
      var eventCount   = (saved.events || []).length;
      var savedAt      = invFormatDateTime(saved.savedAt);
      bar.classList.remove("hidden");
      bar.classList.remove("unsaved");
      $("invAutosaveText").textContent =
        "Saved session found: \"" + sessionLabel + "\" — last saved " + savedAt +
        " with " + eventCount + " event(s). Click Resume Session to load it.";
    }
  }).catch(function(){});
}

// -- Autosave -------------------------------------------------------
function scheduleInvAutosave() {
  invAutosavePending = true;
  var ind = $("invStatusSave");
  if (ind) { ind.textContent = "Unsaved"; ind.className = "inv-status-save unsaved"; }
  clearTimeout(invAutosaveTimer);
  invAutosaveTimer = setTimeout(invAutosave, 500);
}

function invAutosave() {
  if (!invSession) return;
  var payload = {
    schemaVersion: INV_SCHEMA_VERSION,
    savedAt: invNow(),
    session: invSession,
    events: invEvents,
    exceptions: invExceptions,
    recounts: invRecounts,
    settings: invSettings,
    currentLocation: invCurrentLocation || "",
    // Serialize activity feed — time as ISO string so IndexedDB can store it
    activityLog: invActivityLog.map(function(e) {
      return { type: e.type, message: e.message, detail: e.detail || "",
               time: (e.time instanceof Date ? e.time.toISOString() : e.time) };
    })
  };
  invAutosavePending = false;
  TimDB.set(INV_STORAGE_KEY, payload).then(function() {
    var ind = $("invStatusSave");
    if (ind) { ind.textContent = "Saved " + new Date().toLocaleTimeString(); ind.className = "inv-status-save"; }
    renderInvSidebarSession();
  }).catch(function() {
    var ind = $("invStatusSave");
    if (ind) { ind.textContent = "Save failed"; ind.className = "inv-status-save unsaved"; }
  });
}

// -- Event creation -------------------------------------------------
function invCreateEvent(eventType, data) {
  if (!invSession) return null;
  data = data || {};
  invSequence++;
  var evt = {
    eventId:   invGenerateId("evt"),
    timestamp: invNow(),
    sequence:  invSequence,
    eventType: eventType,
    status:    data.status   || "active",
    notes:     data.notes    || "",
    messages:  data.messages || []
  };
  var skip = { status: 1, notes: 1, messages: 1 };
  Object.keys(data).forEach(function(k) { if (!skip[k]) evt[k] = data[k]; });

  invEvents.push(evt);
  invSession.sequenceCounter = invSequence;
  invSession.updatedAt = invNow();
  scheduleInvAutosave();
  renderInvSessionMeta();
  renderInvEventLog();
  return evt;
}

// -- Session management ---------------------------------------------
function invResetSessionState() {
  invEvents     = [];
  invExceptions = [];
  invRecounts   = [];
  invSettings   = {};
  invSequence   = 0;
  invReelIdConflicts = [];
  renderReelIdConflictBanner();
}

function invStartNewSession() {
  var uInp = $("timUsernameInput");
  // Persist input value to localStorage in case oninput never fired (autofill, etc.)
  if (uInp && uInp.value.trim()) timSetUsername(uInp.value);
  // Accept value from either localStorage or the input field directly
  var username = timGetUsername() || (uInp ? uInp.value.trim() : "");
  if (!username) {
    alert("Please enter your name in the sidebar before starting a session.");
    if (uInp) uInp.focus();
    return;
  }

  if (invSession && invSession.status === "active") {
    if (!confirm("A session is already active. Starting a new session will replace it.\n\nExport a backup first if you need to keep the current session.\n\nContinue?")) return;
  }

  var customName = normalize($("invSessionNameInput") ? $("invSessionNameInput").value : "");
  var d = new Date();
  var datePart = d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0");
  var timePart = String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0");
  var name = username + (customName ? "_" + customName : "") + "_" + datePart + "_" + timePart;

  invSession = {
    sessionId:       invGenerateSessionId(),
    sessionName:     name,
    createdAt:       invNow(),
    updatedAt:       invNow(),
    status:          "active",
    sequenceCounter: 0
  };
  invResetSessionState();

  var nameInput = $("invSessionNameInput");
  if (nameInput) nameInput.value = "";
  invAutosave();
  renderInvSessionUI();
}

function invAutoRestoreSession() {
  if (invSession || !invStorageAvailable()) return;
  _invAutoRestoreStarted = true;
  TimDB.get(INV_STORAGE_KEY).then(function(saved) {
    if (!saved || !saved.session) {
      _invAutoRestoreStarted = false;
      invShowStorageHint();
      return;
    }
    invSession    = saved.session;
    invEvents     = saved.events     || [];
    invExceptions = saved.exceptions || [];
    invRecounts   = saved.recounts   || [];
    invSettings   = saved.settings   || {};
    invSequence   = invSession.sequenceCounter || 0;
    invSession.status    = "active";
    invSession.updatedAt = invNow();
    if (saved.currentLocation) invSetLocation(saved.currentLocation);
    if (Array.isArray(saved.activityLog) && saved.activityLog.length) {
      invActivityLog = saved.activityLog.map(function(e) {
        return { type: e.type, message: e.message, detail: e.detail || "",
                 time: e.time ? new Date(e.time) : new Date() };
      });
    }
    renderInvSessionUI();
    renderInvActivityFeed();
    checkReelItemConflicts();
    var bar = $("invAutosaveBar");
    if (bar) {
      bar.classList.remove("hidden");
      bar.classList.remove("unsaved");
      var txt = $("invAutosaveText");
      if (txt) txt.textContent = "Session auto-restored: “" +
        (invSession.sessionName || invSession.sessionId) + "” — " +
        invEvents.length + " event(s). Last saved " + invFormatDateTime(saved.savedAt) + ".";
    }
  }).catch(function() { _invAutoRestoreStarted = false; });
}

function invResumeSession() {
  TimDB.get(INV_STORAGE_KEY).then(function(saved) {
    if (!saved || !saved.session) {
      alert("No saved session found.\n\nUse 'Import Session Backup JSON' to restore from a file export.");
      return;
    }
    invSession    = saved.session;
    invEvents     = saved.events     || [];
    invExceptions = saved.exceptions || [];
    invRecounts   = saved.recounts   || [];
    invSettings   = saved.settings   || {};
    invSequence   = invSession.sequenceCounter || 0;
    invSession.status    = "active";
    invSession.updatedAt = invNow();
    if (saved.currentLocation) invSetLocation(saved.currentLocation);
    if (Array.isArray(saved.activityLog) && saved.activityLog.length) {
      invActivityLog = saved.activityLog.map(function(e) {
        return { type: e.type, message: e.message, detail: e.detail || "",
                 time: e.time ? new Date(e.time) : new Date() };
      });
    }
    invAutosave();
    renderInvSessionUI();
    renderInvActivityFeed();
    checkReelItemConflicts();
    alert("Resumed: " + invSession.sessionId +
          " — " + invEvents.length + " event(s), sequence at #" + invSequence + ".");
  }).catch(function() {
    alert("Failed to read from storage.\n\nUse 'Import Session Backup JSON' to restore from a file export.");
  });
}

function invClearSession() {
  if (!invSession) {
    alert("No active session to clear.");
    return;
  }
  if (!confirm("Clear the active inventory session?\n\nThis removes all events from memory. " +
               "Export a backup JSON first if you need to keep the data.")) return;
  var clearedId = invSession.sessionId;
  invSession    = null;
  invResetSessionState();
  TimDB.remove(INV_STORAGE_KEY).catch(function(){});
  var bar = $("invAutosaveBar");
  if (bar) bar.classList.add("hidden");
  renderInvSessionUI();
  alert("Session " + clearedId + " has been cleared from memory.");
}

function invExportBackup() {
  if (!invSession) { alert("No active session to export."); return; }
  invAutosave();
  var payload = {
    schemaVersion: INV_SCHEMA_VERSION,
    exportedAt:    invNow(),
    session:       invSession,
    events:        invEvents,
    exceptions:    invExceptions,
    recounts:      invRecounts,
    settings:      invSettings
  };
  var d = new Date();
  var stamp = d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" +
    String(d.getDate()).padStart(2, "0") + "-" +
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0");
  downloadText(
    "inventory-session-backup-" + stamp + ".json",
    JSON.stringify(payload, null, 2),
    "application/json"
  );
}

function invImportBackup(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var parsed = JSON.parse(e.target.result);
      if (!parsed.session || !parsed.events) {
        throw new Error("Missing session or events array. Is this a valid inventory backup?");
      }
      if (invSession && !confirm("Replace the current active session with the imported backup?")) {
        input.value = ""; return;
      }
      invSession    = parsed.session;
      invEvents     = parsed.events     || [];
      invExceptions = parsed.exceptions || [];
      invRecounts   = parsed.recounts   || [];
      invSettings   = parsed.settings   || {};
      invSequence   = invSession.sequenceCounter || 0;
      invSession.status = "active";
      invAutosave();
      renderInvSessionUI();
      checkReelItemConflicts();
      alert("Imported: " + invSession.sessionId + " with " + invEvents.length + " event(s).");
    } catch(err) {
      alert("Could not import backup: " + err.message);
    }
    input.value = "";
  };
  reader.readAsText(file);
}

// -- Render helpers -------------------------------------------------
function renderInvSessionMeta() {
  if (!invSession) return;
  var n; // helper to avoid null crashes on hidden legacy elements
  if ((n=$("invMetaName")))       n.textContent = invSession.sessionName || "—";
  if ((n=$("invMetaId")))         n.textContent = invSession.sessionId;
  if ((n=$("invMetaStatus")))     n.textContent = invSession.status;
  if ((n=$("invMetaCreated")))    n.textContent = invFormatDateTime(invSession.createdAt);
  if ((n=$("invMetaUpdated")))    n.textContent = invFormatDateTime(invSession.updatedAt);
  if ((n=$("invMetaEventCount"))) n.textContent = invEvents.length;
  if ((n=$("invMetaSeq")))        n.textContent = invSession.sequenceCounter;
  renderInvStatusBar();
  renderInvSidebarSession();
}

function renderInvSessionUI() {
  var hasSession = !!invSession;
  var noSess = $("invNoSession"); if (noSess) noSess.classList.toggle("hidden", hasSession);
  var meta   = $("invSessionMeta"); if (meta) meta.classList.toggle("hidden", !hasSession);
  var clrBtn = $("invClearBtn");    if (clrBtn) clrBtn.disabled = !hasSession;
  var finBtn = $("invFinalizeBtn"); if (finBtn) finBtn.disabled = !hasSession;
  if (hasSession) renderInvSessionMeta();
  renderInvSidebarSession();
  renderInvStatusBar();
  renderInvEventLog();
}

function renderInvSidebarSession() {
  var hasSession  = !!invSession;
  var isClosed    = hasSession && invSession.status === "closed";
  var isRecount   = hasSession && invSession.sessionType === "recount";
  var dot         = $("sideInvDot");
  var noSess      = $("sideInvNoSession");
  var info        = $("sideInvInfo");
  var nameEl      = $("sideInvName");
  var statsEl     = $("sideInvStats");
  var clrBtn      = $("invClearBtn");
  var finBtn      = $("invFinalizeBtn");
  var rcBtn       = $("invRecountBtn");

  if (dot)    dot.classList.toggle("active", hasSession);
  if (noSess) noSess.classList.toggle("hidden", hasSession);
  if (info)   info.classList.toggle("hidden", !hasSession);
  if (clrBtn) clrBtn.disabled = !hasSession;
  if (finBtn) finBtn.disabled = !hasSession || isClosed;
  if (rcBtn)  rcBtn.disabled  = !(isClosed && !isRecount);

  if (hasSession && invSession) {
    if (nameEl)  nameEl.textContent  = invSession.sessionName;
    var excCount = invEvents.filter(function(e) { return e.eventType === "exception"; }).length;
    if (statsEl) statsEl.textContent = invEvents.length + " events · " + excCount + " exceptions" +
                                       (isRecount ? " · RECOUNT" : "");
  }
}

function renderInvStatusBar() {
  var bar = $("invStatusBar");
  if (!bar) return;
  var hasSession = !!invSession;
  bar.classList.toggle("hidden", !hasSession);
  if (!hasSession) return;

  var modePill = $("invStatusModePill");
  if (modePill) {
    var modeLabel = { auto: "AUTO", serial: "SERIAL", reel: "REEL", item: "ITEM" };
    modePill.textContent = modeLabel[invScanMode] || "AUTO";
    modePill.className   = "inv-status-mode-pill" + (invScanMode !== "auto" ? " mode-" + invScanMode : "");
  }

  var locText = $("invStatusLocText");
  if (locText) {
    if (invCurrentLocation) {
      locText.textContent = invCurrentLocation;
      locText.classList.remove("no-loc");
    } else {
      locText.textContent = "No location";
      locText.classList.add("no-loc");
    }
  }

  var sessEl = $("invStatusSession");
  if (sessEl) sessEl.textContent = invSession.sessionName;

  var countsEl = $("invStatusCounts");
  if (countsEl) {
    var exc = invEvents.filter(function(e) { return e.eventType === "exception"; }).length;
    countsEl.textContent = invEvents.length + " events" + (exc ? " · " + exc + " exc." : "");
  }
}

function renderInvEventLog() {
  var tbody = $("invEventLogBody");
  if (!tbody) return;

  var searchQ      = normKey(($("invLogSearch")    ? $("invLogSearch").value    : "") || "");
  var filterType   = $("invLogFilterType")   ? $("invLogFilterType").value   : "";
  var filterStatus = $("invLogFilterStatus") ? $("invLogFilterStatus").value : "";

  var filtered = invEvents.filter(function(evt) {
    // void_event meta-rows are absorbed into the target event's notes modal;
    // only show them when the user explicitly filters for that type
    if (evt.eventType === "void_event" && filterType !== "void_event") return false;
    if (filterType   && evt.eventType !== filterType)   return false;
    if (filterStatus && evt.status    !== filterStatus) return false;
    if (searchQ && normKey(JSON.stringify(evt)).indexOf(searchQ) === -1) return false;
    return true;
  });

  $("invLogCount").textContent = filtered.length + " of " + invEvents.length + " events";
  var exportLogBtn = $("invExportEventLogBtn");
  var logDis = !invEvents.length || !invSession;
  if (exportLogBtn) exportLogBtn.disabled = logDis;
  var logCaret = $("invExportEventLogCaretBtn"); if (logCaret) logCaret.disabled = logDis;

  if (!filtered.length) {
    var msg = invEvents.length ? "No events match the current filters." :
                                 "No events yet. Start a session and begin scanning.";
    tbody.innerHTML = '<tr><td colspan="16" style="text-align:center;color:#94a3b8;padding:24px;">' +
                      escapeHtml(msg) + "</td></tr>";
    return;
  }

  tbody.innerHTML = filtered.slice().reverse().map(function(evt) {
    var voided      = evt.status === "voided";
    var isVoidMeta  = evt.eventType === "void_event";
    var typeClass   = "event-type-pill" + (voided ? " voided" : "");
    var statusClass = voided ? "block" : "ok";
    var eid         = escapeHtml(evt.eventId);

    // Note icon button
    var hasNotes = !!(evt.notes && evt.notes.trim());
    var noteBtn  = '<button class="inv-note-btn ' + (hasNotes ? "has-notes" : "no-notes") + '" ' +
                  'title="' + (hasNotes ? escapeHtml(evt.notes) : "Add note") + '" ' +
                  'onclick="invOpenNotesModal(\'' + eid + '\')">' +
                  (hasNotes ? "📝" : "✎") + '</button>';

    // Action buttons
    var actionBtns = "";
    if (!voided && !isVoidMeta) {
      actionBtns += '<button class="danger" style="padding:4px 8px;font-size:12px;" ' +
                    'onclick="invVoidEvent(\'' + eid + '\')">Void</button> ';
    }
    if (voided && !isVoidMeta) {
      actionBtns += '<button class="secondary" style="padding:4px 8px;font-size:12px;" ' +
                    'onclick="invUndoVoid(\'' + eid + '\')">Undo Void</button> ';
    }
    if (!voided && evt.eventType === "bulk_quantity_count") {
      actionBtns += '<button class="secondary" style="padding:4px 8px;font-size:12px;" ' +
                    'onclick="invEditEventQty(\'' + eid + '\')">Edit Qty</button>';
    }

    // Qty display
    var qtyDisplay = evt.qty != null ? String(evt.qty) : "";
    if (evt.eventType === "cable_reel_count" && evt.totalAvailableFt != null) {
      qtyDisplay = evt.totalAvailableFt.toLocaleString() + " ft";
    }
    if (isVoidMeta && evt.targetSequence != null) {
      qtyDisplay = "";
    }

    var flagBtn = '<button class="inv-flag-btn' + (evt.flagged ? " flagged" : "") + '" ' +
                  'title="' + (evt.flagged ? "Unflag" : "Flag for recount") + '" ' +
                  'onclick="invToggleFlag(\'' + eid + '\')">' +
                  (evt.flagged ? "&#128681;" : "&#9873;") + '</button>';
    var rowClass = voided ? "warn" : (evt.flagged ? "inv-flagged-row" : "");

    return "<tr" + (rowClass ? ' class="' + rowClass + '"' : "") + ">" +
      "<td>" + (evt.sequence != null ? evt.sequence : "") + "</td>" +
      '<td style="white-space:nowrap">' + invFormatTime(evt.timestamp) + "</td>" +
      '<td><span class="' + typeClass + '">' + escapeHtml(evt.eventType || "") + "</span>" +
        (isVoidMeta && evt.targetSequence != null
          ? ' <span class="small">(voids #' + evt.targetSequence + ")</span>"
          : "") + "</td>" +
      "<td>" + escapeHtml(evt.scanType     || "") + "</td>" +
      "<td>" + escapeHtml(evt.scannedValue || "") + "</td>" +
      "<td>" + escapeHtml(evt.itemNumber   || "") + "</td>" +
      "<td>" + escapeHtml(evt.description  || "") + "</td>" +
      "<td>" + escapeHtml(evt.serial       || "") + "</td>" +
      "<td>" + escapeHtml(evt.fsan         || "") + "</td>" +
      "<td>" + escapeHtml(evt.boxId        || "") + "</td>" +
      "<td>" + escapeHtml(evt.location     || "") + "</td>" +
      "<td>" + escapeHtml(qtyDisplay) + "</td>" +
      '<td><span class="pill ' + statusClass + '">' + escapeHtml(evt.status || "") + "</span></td>" +
      "<td style=\"text-align:center\">" + flagBtn + "</td>" +
      "<td style=\"text-align:center\">" + noteBtn + "</td>" +
      "<td style=\"white-space:nowrap\">" + actionBtns + "</td>" +
      "</tr>";
  }).join("");

  renderInvSummary();
}

// ===================================================================
// INVENTORY MODE — Phase 3: Summary + CSV Exports
// ===================================================================

function renderInvSummary() {
  var tbody     = $("invSummaryBody");
  var reelTbody = $("invReelDetailBody");
  var reelSect  = $("invReelDetailSection");
  var exportBtn = $("invExportSummaryBtn");
  if (!tbody) return;

  // Derive totals from active (non-voided) events only
  var map = {};
  var reelRows = [];
  invEvents.forEach(function(evt) {
    if (evt.status === "voided")           return;
    if (evt.eventType === "void_event")    return;

    var key = evt.itemNumber || evt.scannedValue || "(unknown)";
    if (!map[key]) {
      map[key] = {
        item:            key,
        description:     evt.description || "",
        countedQty:      0,
        serializedCount: 0,
        reelFootage:     0,
        exceptions:      0,
        lastCounted:     evt.timestamp || ""
      };
    }
    var r = map[key];
    if (evt.description && !r.description) r.description = evt.description;
    if (evt.timestamp && evt.timestamp > r.lastCounted) r.lastCounted = evt.timestamp;

    if      (evt.eventType === "serialized_device_scan") { r.countedQty += 1; r.serializedCount += 1; }
    else if (evt.eventType === "box_scan")               { r.countedQty += (evt.resolvedDeviceCount || evt.qty || 1); r.serializedCount += (evt.resolvedDeviceCount || 0); }
    else if (evt.eventType === "bulk_quantity_count")    { r.countedQty += (evt.qty || 1); }
    else if (evt.eventType === "cable_reel_count") {
      r.reelFootage += (evt.totalAvailableFt || 0);
      reelRows.push(evt);
    }
    else if (evt.eventType === "exception")              { r.exceptions += 1; }
  });

  var rows = Object.keys(map).sort().map(function(k) { return map[k]; });

  var dis = !rows.length || !invSession;
  if (exportBtn) exportBtn.disabled = dis;
  var summCaret = $("invExportSummaryCaretBtn"); if (summCaret) summCaret.disabled = dis;
  var adjBtn    = $("invExportOdooAdjBtn");      if (adjBtn)    adjBtn.disabled    = dis;
  var adjCaret  = $("invExportOdooAdjCaretBtn"); if (adjCaret)  adjCaret.disabled  = dis;

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:16px;">No items counted yet.</td></tr>';
  } else {
    tbody.innerHTML = rows.map(function(r) {
      return "<tr>" +
        "<td>" + escapeHtml(r.item) + "</td>" +
        "<td>" + escapeHtml(r.description) + "</td>" +
        '<td style="text-align:right;font-weight:700">' + (r.countedQty || "") + "</td>" +
        '<td style="text-align:right">' + (r.serializedCount || "") + "</td>" +
        '<td style="text-align:right">' + (r.reelFootage ? r.reelFootage.toLocaleString() + " ft" : "") + "</td>" +
        '<td style="text-align:right' + (r.exceptions ? ";color:#dc2626;font-weight:700" : "") + '">' +
          (r.exceptions || "") + "</td>" +
        '<td style="white-space:nowrap">' + invFormatDateTime(r.lastCounted) + "</td>" +
        "</tr>";
    }).join("");
  }

  // Reel detail table
  if (reelTbody && reelSect) {
    if (!reelRows.length) {
      reelSect.style.display = "none";
    } else {
      reelSect.style.display = "";
      reelTbody.innerHTML = reelRows.map(function(e) {
        var isTwoWay = e.spanType === "two_way";
        return "<tr>" +
          "<td style='font-family:monospace;font-weight:700'>" + escapeHtml(e.reelNumber || e.scannedValue || "") + "</td>" +
          "<td>" + escapeHtml(e.itemNumber || "") + "</td>" +
          "<td>" + (isTwoWay ? "Two-Way" : "Single") + "</td>" +
          '<td style="text-align:right">' + (e.innerSeqA != null ? e.innerSeqA : "") + "</td>" +
          '<td style="text-align:right">' + (e.outerSeqA != null ? e.outerSeqA : "") + "</td>" +
          '<td style="text-align:right;color:#1d4ed8;font-weight:700">' + (e.availableFtA != null ? e.availableFtA.toLocaleString() : "") + "</td>" +
          '<td style="text-align:right">' + (isTwoWay && e.innerSeqB != null ? e.innerSeqB : "—") + "</td>" +
          '<td style="text-align:right">' + (isTwoWay && e.outerSeqB != null ? e.outerSeqB : "—") + "</td>" +
          '<td style="text-align:right;color:#16a34a;font-weight:700">' + (isTwoWay && e.availableFtB != null ? e.availableFtB.toLocaleString() : "—") + "</td>" +
          '<td style="text-align:right;font-weight:800;color:#1d4ed8">' + ((e.totalAvailableFt || 0).toLocaleString()) + " ft</td>" +
          "<td>" + escapeHtml(e.location || "") + "</td>" +
          '<td style="white-space:nowrap">' + invFormatDateTime(e.timestamp) + "</td>" +
          "</tr>";
      }).join("");
    }
  }
}

// -- Shared export helpers -----------------------------------------

function requireInvSession() {
  if (!invSession) { alert("No active session."); return false; }
  return true;
}

// Returns the 13 common fields for an event log row (no "Flagged" column).
// XLSX export appends flagged + notes; CSV export appends notes only.
function buildEventLogBaseRow(e) {
  return [
    e.sequence    != null ? e.sequence : "",
    e.timestamp          || "",
    e.eventType          || "",
    e.scanType           || "",
    e.scannedValue       || "",
    e.itemNumber         || "",
    e.description        || "",
    e.serial             || "",
    e.fsan               || "",
    e.boxId              || "",
    e.location           || "",
    e.qty       != null  ? e.qty : "",
    e.status             || ""
  ];
}

// Aggregates invEvents into a per-item summary map (includes flagged count).
function buildInvSummaryMap(events) {
  var map = {};
  events.forEach(function(evt) {
    if (evt.status === "voided")        return;
    if (evt.eventType === "void_event") return;
    var key = evt.itemNumber || evt.scannedValue || "(unknown)";
    if (!map[key]) map[key] = { item: key, description: evt.description || "", countedQty: 0, serializedCount: 0, reelFootage: 0, exceptions: 0, flagged: 0, lastCounted: evt.timestamp || "" };
    var r = map[key];
    if (evt.description && !r.description) r.description = evt.description;
    if (evt.timestamp && evt.timestamp > r.lastCounted) r.lastCounted = evt.timestamp;
    if      (evt.eventType === "serialized_device_scan") { r.countedQty += 1; r.serializedCount += 1; }
    else if (evt.eventType === "box_scan")               { r.countedQty += (evt.resolvedDeviceCount || evt.qty || 1); r.serializedCount += (evt.resolvedDeviceCount || 0); }
    else if (evt.eventType === "bulk_quantity_count")    { r.countedQty += (evt.qty || 1); }
    else if (evt.eventType === "cable_reel_count")       { r.reelFootage += (evt.totalAvailableFt || 0); }
    else if (evt.eventType === "exception")              { r.exceptions += 1; }
    if (evt.flagged) r.flagged += 1;
  });
  return map;
}

function exportInvEventLogCsv() {
  if (!requireInvSession()) return;
  var header = ["Seq","Timestamp","Event Type","Scan Type","Scanned Value",
                "Item","Description","Serial","FSAN","Box ID","Location","Qty","Status","Notes"];
  var lines = [header.join(",")].concat(invEvents.map(function(evt) {
    return buildEventLogBaseRow(evt).concat([evt.notes || ""]).map(csvEscape).join(",");
  }));
  var stamp = new Date().toISOString().slice(0, 10);
  downloadText("inv-event-log-" + stamp + ".csv", lines.join("\r\n"), "text/csv");
}

function exportInvSummaryCsv() {
  if (!requireInvSession()) return;
  var map = buildInvSummaryMap(invEvents);
  var header = ["Item","Description","Counted Qty","Serialized Count","Reel Footage (ft)","Exceptions","Last Counted"];
  var lines = [header.join(",")].concat(
    Object.keys(map).sort().map(function(k) {
      var r = map[k];
      return [r.item, r.description, r.countedQty, r.serializedCount, r.reelFootage || "", r.exceptions, r.lastCounted].map(csvEscape).join(",");
    })
  );
  var stamp = new Date().toISOString().slice(0, 10);
  downloadText("inv-summary-" + stamp + ".csv", lines.join("\r\n"), "text/csv");
}

function invVoidEvent(eventId) {
  var evt = invEvents.find(function(e) { return e.eventId === eventId; });
  if (!evt || evt.status === "voided") return;
  if (!confirm("Void event #" + evt.sequence + " (" + evt.eventType + ")?\n\n" +
               "The event is preserved for audit — it will be marked voided, not deleted.")) return;
  invCreateEvent("void_event", {
    targetEventId:   eventId,
    targetSequence:  evt.sequence,
    targetEventType: evt.eventType
  });
  evt.status = "voided";
  if (!evt.voidLog) evt.voidLog = [];
  evt.voidLog.push({ action: "voided", at: invNow() });
  invSession.updatedAt = invNow();
  scheduleInvAutosave();
  renderInvEventLog();
  renderInvExceptions();
}

function invUndoVoid(eventId) {
  var evt = invEvents.find(function(e) { return e.eventId === eventId; });
  if (!evt || evt.status !== "voided") return;
  if (!confirm("Undo void for event #" + evt.sequence + " (" + evt.eventType + ")?\n\n" +
               "The event will be restored to active status.")) return;
  evt.status = "active";
  if (!evt.voidLog) evt.voidLog = [];
  evt.voidLog.push({ action: "undo_void", at: invNow() });
  // Mark the corresponding void_event as voided (keeps audit trail clean)
  var voidRecord = invEvents.find(function(e) {
    return e.eventType === "void_event" && e.targetEventId === eventId && e.status === "active";
  });
  if (voidRecord) voidRecord.status = "voided";
  invSession.updatedAt = invNow();
  scheduleInvAutosave();
  renderInvEventLog();
  renderInvExceptions();
}

function invOpenNotesModal(eventId) {
  var evt = invEvents.find(function(e) { return e.eventId === eventId; });
  if (!evt) return;
  invNotesModalEventId = eventId;
  var desc    = $("invNotesModalDesc");
  var info    = $("invNotesModalInfo");
  var text    = $("invNotesModalText");
  var histBox = $("invNotesModalHistory");
  var histList= $("invNotesModalHistoryList");

  if (desc) desc.textContent = "Event #" + evt.sequence + " — " + (evt.eventType || "");
  if (info) {
    var parts = [];
    if (evt.scannedValue) parts.push("Value: " + evt.scannedValue);
    if (evt.itemNumber)   parts.push("Item: " + evt.itemNumber);
    if (evt.serial)       parts.push("S/N: " + evt.serial);
    if (evt.fsan)         parts.push("FSAN: " + evt.fsan);
    if (evt.location)     parts.push("Location: " + evt.location);
    info.textContent = parts.join("  •  ");
  }
  if (text) text.value = evt.notes || "";

  // Void history
  if (histBox && histList) {
    var log = evt.voidLog || [];
    if (log.length) {
      histList.innerHTML = log.map(function(entry) {
        var label = entry.action === "voided"    ? "Voided" :
                    entry.action === "undo_void" ? "Void undone" : entry.action;
        var color = entry.action === "voided"    ? "#991b1b" :
                    entry.action === "undo_void" ? "#166534" : "#475569";
        return '<div style="padding:4px 0;border-bottom:1px solid #f1f5f9;color:' + color + ';">' +
               '<b>' + escapeHtml(label) + '</b>' +
               '<span style="color:#64748b;margin-left:8px;">' + invFormatDateTime(entry.at) + '</span>' +
               '</div>';
      }).join("");
      histBox.style.display = "block";
    } else {
      histBox.style.display = "none";
    }
  }

  var modal = $("invNotesModal");
  if (modal) {
    modal.classList.remove("hidden");
    setTimeout(function() { if (text) text.focus(); }, 50);
  }
}

function invSaveNotesModal() {
  if (!invNotesModalEventId) return;
  var evt = invEvents.find(function(e) { return e.eventId === invNotesModalEventId; });
  if (!evt) return;
  var text = $("invNotesModalText");
  evt.notes = text ? text.value.trim() : "";
  invSession.updatedAt = invNow();
  scheduleInvAutosave();
  renderInvEventLog();
  invCloseNotesModal();
}

function invCloseNotesModal() {
  invNotesModalEventId = null;
  var modal = $("invNotesModal");
  if (modal) modal.classList.add("hidden");
  setTimeout(function() { var i = $("invScanInput"); if (i) i.focus(); }, 50);
}

function invEditEventQty(eventId) {
  var evt = invEvents.find(function(e) { return e.eventId === eventId; });
  if (!evt || evt.eventType !== "bulk_quantity_count") return;
  var current = evt.qty != null ? String(evt.qty) : "1";
  var input = prompt(
    "Update quantity for event #" + evt.sequence + "\n" +
    "Item: " + (evt.itemNumber || "—") + (evt.description ? "  (" + evt.description + ")" : "") + "\n\n" +
    "Current qty: " + current,
    current
  );
  if (input === null) return;
  var newQty = parseInt(input, 10);
  if (isNaN(newQty) || newQty < 1) { alert("Invalid quantity. Enter a whole number ≥ 1."); return; }
  evt.qty = newQty;
  invSession.updatedAt = invNow();
  scheduleInvAutosave();
  renderInvEventLog();
}

// ===================================================================
// INVENTORY MODE — Phase 2: Scan Detection & Processing
// ===================================================================

// -- Scan type auto-detection ---------------------------------------
function invClassifyScan(raw) {
  var v = String(raw || "").trim().toUpperCase();
  if (!v) return "unknown";

  // FSAN: Calix CXNK prefix — check before anything else
  if (/^CXNK/i.test(v)) return "fsan";

  // Box ID prefix
  if (/^BOX/i.test(v)) return "box_id";

  // Location prefix (warehouse locations start with WH)
  if (/^WH/i.test(v)) return "location";

  // Reel number prefix
  if (/^REEL/i.test(v)) return "reel_number";

  // History lookup comes BEFORE MAC detection so known serials/FSANs
  // are never misidentified as MAC addresses
  var vKey = normKey(v);
  var records = history.records || [];

  var asFsan = records.some(function(r) {
    return normKey(r.fsan || r.name || "") === vKey;
  });
  if (asFsan) return "fsan";

  var asSerial = records.some(function(r) {
    return normKey(r.serial || r.ref || "") === vKey;
  });
  if (asSerial) return "serial";

  // Product map match → item number (before MAC so item codes with hex chars aren't caught)
  if (findProductMapMatch(v)) return "item_number";

  // Barcode map check — after product map to avoid misclassifying item numbers
  if (BARCODE_MAP[normKey(v)]) return "barcode";

  // MAC detection — only after history/product map checks to avoid false positives.
  // Formatted MAC (AA:BB:CC:DD:EE:FF or AA-BB-CC-DD-EE-FF): accept unambiguously.
  // Bare 12-hex-char string: only accept if it matches a known MAC in history,
  // otherwise it is indistinguishable from a serial number.
  var macBare = v.replace(/[:\-\.]/g, "");
  if (/^[0-9A-F]{12}$/.test(macBare)) {
    var isFormattedMac = (v.length === 17 && /^[0-9A-F]{2}([:.-])[0-9A-F]{2}\1[0-9A-F]{2}\1[0-9A-F]{2}\1[0-9A-F]{2}\1[0-9A-F]{2}$/.test(v));
    var isKnownMac     = records.some(function(r) {
      return normKey((r.mac_address || r.mac || "").replace(/[:\-\.]/g, "")) === normKey(macBare);
    });
    if (isFormattedMac || isKnownMac) return "mac";
  }

  // Alphanumeric with dashes typical of serialized hardware
  if (/^[A-Z0-9][A-Z0-9\-]{3,}$/.test(v)) return "serial";

  return "unknown";
}

function invUpdateDetectedBadge(raw) {
  var badge = $("invDetectedBadge");
  if (!badge) return;
  var override = $("invScanTypeOverride") ? $("invScanTypeOverride").value : "";
  var type = override || (raw ? invClassifyScan(raw) : "");
  var label = override ? ("override: " + type) : ("detected: " + (type || "—"));
  badge.textContent = label;
  badge.className = "inv-detected-badge" +
    (!type || type === "unknown" ? " unknown" : type === "exception" ? " exception" : "");
}

// -- History resolution helpers ------------------------------------
function invResolveBySerial(serialKey) {
  return (history.records || []).find(function(r) {
    return normKey(r.serial || r.ref || "") === serialKey;
  }) || null;
}

function invResolveByFsan(fsanKey) {
  return (history.records || []).find(function(r) {
    return normKey(r.fsan || r.name || "") === fsanKey;
  }) || null;
}

function invResolveByMac(macBare) {
  return (history.records || []).find(function(r) {
    return normKey((r.mac_address || r.mac || "").replace(/[:\-\.]/g, "")) === macBare;
  }) || null;
}

// -- Duplicate detection -------------------------------------------
function invFindSerializedDuplicate(serial, fsan) {
  var sk = normKey(serial);
  var fk = normKey(fsan);
  return invEvents.find(function(e) {
    if (e.eventType !== "serialized_device_scan") return false;
    if (e.status === "voided") return false;
    if (sk && normKey(e.serial || "") === sk) return true;
    if (fk && normKey(e.fsan   || "") === fk) return true;
    return false;
  }) || null;
}

// -- Exception events ----------------------------------------------
function invCreateExceptionEvent(scannedValue, scanType, problem, suggestedAction, notes) {
  var evt = invCreateEvent("exception", {
    scanType:        scanType || "unknown",
    scannedValue:    scannedValue || "",
    problem:         problem || "",
    suggestedAction: suggestedAction || "",
    notes:           notes || ""
  });
  renderInvExceptions();
  return evt;
}

// -- Scan feedback -------------------------------------------------
function invSetScanFeedback(message, type, activityDetail, beepType) {
  var fb = $("invScanFeedback");
  if (fb) { fb.textContent = message; fb.className = "inv-scan-feedback " + (type || "info"); }
  if (type === "ok" || type === "warn" || type === "error") {
    invAddActivity(type, message, activityDetail || "", beepType);
  }
}

// -- Individual scan handlers --------------------------------------
function invHandleSerializedScan(value, scanType, contextItem, notes, location) {
  var vKey = normKey(value);
  var serial = "", fsan = "", histRecord = null;

  if (scanType === "serial") {
    serial = value;
    histRecord = invResolveBySerial(vKey);
    if (histRecord) fsan = normalize(histRecord.fsan || histRecord.name || "");
  } else {
    fsan = value;
    histRecord = invResolveByFsan(vKey);
    if (histRecord) serial = normalize(histRecord.serial || histRecord.ref || "");
  }

  // Duplicate check
  var dupEvt = invFindSerializedDuplicate(serial || value, fsan);
  if (dupEvt) {
    invCreateExceptionEvent(value, scanType,
      "Device already counted at " + invFormatTime(dupEvt.timestamp) + " (event #" + dupEvt.sequence + ")",
      "Review event #" + dupEvt.sequence + ". Void it if it was scanned in error.",
      notes);
    invSetScanFeedback(
      "DUPLICATE: " + value + " was already counted at " +
      invFormatTime(dupEvt.timestamp) + " (event #" + dupEvt.sequence + "). Exception created.",
      "error");
    return false;
  }

  // Resolve item / description
  var itemNumber = contextItem || "";
  var description = "";
  if (!itemNumber && histRecord) {
    itemNumber = normalize(histRecord.hctc || histRecord.calix_product || histRecord.product || "");
  }
  if (itemNumber) {
    var mm = findProductMapMatch(itemNumber);
    if (mm) description = getMapDescription(mm.entry);
  }
  if (!description && histRecord) {
    description = normalize(histRecord.odoo_name || histRecord.calix_description || "");
  }

  // Unknown device — show inline prompt instead of immediate exception
  if (!histRecord && !contextItem) {
    invSetScanFeedback(
      "Unknown device: " + value + " — fill in details below and Commit, or Cancel to log an exception.",
      "warn");
    invShowSerialPrompt(value, scanType, location || invCurrentLocation);
    return false;
  }

  invCreateEvent("serialized_device_scan", {
    scanType:     scanType,
    scannedValue: value,
    serial:       serial || (scanType === "serial" ? value : ""),
    fsan:         fsan   || (scanType === "fsan"   ? value : ""),
    itemNumber:   itemNumber,
    description:  description,
    location:     location || "",
    qty:          1,
    notes:        notes
  });

  var detail = description ? " (" + description + ")" : "";
  var ids = [];
  if (serial) ids.push("S/N: " + serial);
  if (fsan)   ids.push("FSAN: " + fsan);
  invSetScanFeedback("Counted: " + value + detail + (ids.length ? "  " + ids.join("  ") : ""), "ok", "", "serialized");
  return true;
}

function invHandleBoxScan(boxId, contextItem, notes, location) {
  var vKey = normKey(boxId);
  var boxDevices = (history.records || []).filter(function(r) {
    return normKey(r.sale_order || "") === vKey ||
           normKey(r.box_id     || "") === vKey;
  });

  // Always record the box_scan event
  invCreateEvent("box_scan", {
    scanType:            "box_id",
    scannedValue:        boxId,
    boxId:               boxId,
    location:            location || "",
    resolvedDeviceCount: boxDevices.length,
    notes:               notes
  });

  if (!boxDevices.length) {
    invCreateExceptionEvent(boxId, "box_id",
      "Box ID not found in history — no devices resolved",
      "Verify the box ID matches a Sale Order or Box ID in the loaded history JSON.",
      notes);
    invSetScanFeedback("Box \"" + boxId + "\" not found in history. Exception created.", "warn");
    return false;
  }

  var counted = 0;
  boxDevices.forEach(function(r) {
    var serial = normalize(r.serial || r.ref || "");
    var fsan   = normalize(r.fsan   || r.name || "");
    var dup    = invFindSerializedDuplicate(serial, fsan);
    if (dup) {
      invCreateExceptionEvent(serial || fsan, "serial",
        "Box device already counted (event #" + dup.sequence + ")",
        "Review event #" + dup.sequence + " for duplicate.",
        notes);
    } else {
      invCreateEvent("serialized_device_scan", {
        scanType:     "box_id",
        scannedValue: boxId,
        serial:       serial,
        fsan:         fsan,
        boxId:        boxId,
        location:     location || "",
        itemNumber:   normalize(r.hctc || r.calix_product || ""),
        description:  normalize(r.odoo_name || r.calix_description || ""),
        qty:          1,
        notes:        "From box " + boxId
      });
      counted++;
    }
  });

  invSetScanFeedback(
    "Box " + boxId + ": " + counted + " of " + boxDevices.length + " device(s) counted." +
    (counted < boxDevices.length ? " " + (boxDevices.length - counted) + " duplicate(s) flagged." : ""),
    counted === boxDevices.length ? "ok" : "warn", "", counted > 0 ? "serialized" : "");
  return true;
}

function invHandleBulkCount(itemNumber, qty, notes, location) {
  var mm = findProductMapMatch(itemNumber);
  var description = mm ? getMapDescription(mm.entry) : "";

  if (!mm) {
    invCreateExceptionEvent(itemNumber, "item_number",
      "Item not found in product map",
      "Add a product mapping for this item number.",
      notes);
  }

  var evt = invCreateEvent("bulk_quantity_count", {
    scanType:     "item_number",
    scannedValue: itemNumber,
    itemNumber:   itemNumber,
    description:  description,
    location:     location || "",
    qty:          qty,
    notes:        notes
  });

  // Track the last bulk event so the qty keypad can adjust it
  invLastBulkEventId = evt ? evt.eventId : null;

  // Phase 6a: other-location cross-ref for activity feed detail
  var otherLocs = invEvents.filter(function(e) {
    return e.eventType === "bulk_quantity_count" && e.status !== "voided" &&
           e.eventId !== (evt ? evt.eventId : null) &&
           normKey(e.itemNumber || "") === normKey(itemNumber) &&
           normKey(e.location   || "") !== normKey(location   || "");
  }).map(function(e) { return e.location; }).filter(function(v,i,a) { return v && a.indexOf(v)===i; });
  var locDetail = otherLocs.length ? "Also counted at: " + otherLocs.join(", ") : "";

  // Phase 6b: auto-flag if same item+location appears in last 2 finalized sessions
  var closedSessions = (appData.inventory_sessions || [])
    .filter(function(s) { return s.status === "closed"; })
    .sort(function(a,b) { return (b.closedAt||"") > (a.closedAt||"") ? 1 : -1; })
    .slice(0, 2);
  if (closedSessions.length === 2 && evt) {
    var pastEvts = appData.inventory_events || [];
    var inBoth = closedSessions.every(function(sess) {
      return pastEvts.some(function(e) {
        return e.sessionId === sess.sessionId && e.status !== "voided" &&
               normKey(e.itemNumber || "") === normKey(itemNumber) &&
               normKey(e.location   || "") === normKey(location   || "");
      });
    });
    if (inBoth) {
      evt.flagged = true;
      invAddActivity("warn",
        itemNumber + " auto-flagged — present in last 2 finalized sessions at this location",
        location || "");
    }
  }

  invSetScanFeedback(
    "Counted " + qty + "x " + itemNumber + (description ? " (" + description + ")" : "") + "." +
    (!mm ? "  WARNING: item not in product map — exception created." : ""),
    mm ? "ok" : "warn",
    locDetail, mm ? "bulk" : "");
  return true;
}

function invHandleMacScan(mac, contextItem, notes, location) {
  var macBare = normKey(mac.replace(/[:\-\.]/g, ""));
  var histRecord = invResolveByMac(macBare);

  if (histRecord) {
    var serial = normalize(histRecord.serial || histRecord.ref || "");
    if (serial) {
      return invHandleSerializedScan(serial, "serial", contextItem, notes, location);
    }
  }

  invCreateExceptionEvent(mac, "mac",
    "MAC address not found in history",
    "Scan the serial number instead, or load a history JSON that includes this device.",
    notes);
  invSetScanFeedback("MAC " + mac + " not in history. Exception created.", "warn");
  return false;
}

// -- Location helpers ----------------------------------------------
function invSetLocation(loc) {
  invCurrentLocation = (loc || "").trim().toUpperCase();
  var display = $("invLocationDisplay");
  var field   = $("invScanLocation");
  var chip    = $("invLocBarValue");
  var chipBtn = $("invLocChip");
  if (display) {
    if (invCurrentLocation) {
      display.textContent = invCurrentLocation;
      display.className = "inv-location-value";
    } else {
      display.textContent = "None — scan a LOC barcode or type below to set";
      display.className = "inv-location-none";
    }
  }
  if (chip) {
    chip.textContent = invCurrentLocation || "—";
    chip.className = "inv-loc-chip-value" + (invCurrentLocation ? "" : " inv-loc-chip-none");
  }
  if (chipBtn) {
    if (invCurrentLocation) chipBtn.classList.add("loc-set");
    else chipBtn.classList.remove("loc-set");
  }
  if (field) field.value = invCurrentLocation;
  renderInvStatusBar();
}

function invToggleLocPopover(e) {
  e.stopPropagation();
  var pop = $("invLocPopover");
  if (!pop) return;
  if (pop.classList.contains("hidden")) {
    pop.classList.remove("hidden");
    var inp = $("invLocPopoverInput");
    if (inp) { inp.value = invCurrentLocation || ""; setTimeout(function(){ inp.focus(); inp.select(); }, 30); }
  } else {
    pop.classList.add("hidden");
  }
}

function invLocPopoverSet() {
  var inp = $("invLocPopoverInput");
  var val = inp ? inp.value.trim().toUpperCase() : "";
  if (val) invSetLocation(val);
  invCloseLocPopover();
  setTimeout(function(){ $("invScanInput").focus(); }, 50);
}

function invCloseLocPopover() {
  var pop = $("invLocPopover");
  if (pop) pop.classList.add("hidden");
}

function invClearLocation() {
  invSetLocation("");
  invSetScanFeedback("Location cleared.", "info");
  setTimeout(function() { $("invScanInput").focus(); }, 50);
}

// ===================================================================
// SCAN MODE TOGGLE
// ===================================================================

function invSetScanMode(mode) {
  invScanMode = mode;
  var modeActiveClass = { auto: "active", serial: "active-serial", reel: "active-reel", item: "active-item" };
  var modes = ["auto", "serial", "reel", "item"];
  modes.forEach(function(m) {
    var btn = $("invModeBtn" + m.charAt(0).toUpperCase() + m.slice(1));
    if (!btn) return;
    btn.className = "inv-mode-btn" + (m === mode ? " " + modeActiveClass[mode] : "");
  });
  // Wire hidden override select so existing invProcessScan logic picks it up
  var overrideMap = { auto: "", serial: "", reel: "", item: "item_number" };
  var override = $("invScanTypeOverride");
  if (override) override.value = overrideMap[mode] || "";
  // Update placeholder for user guidance
  var placeholders = {
    auto:   "Scan barcode or type value, then press Enter",
    serial: "Scan serial number or FSAN, then press Enter",
    reel:   "Scan reel number, then press Enter",
    item:   "Scan item number for bulk count, then press Enter"
  };
  var input = $("invScanInput");
  if (input) input.placeholder = placeholders[mode] || placeholders.auto;

  var kp  = $("invQtyKeypad");
  var rip = $("invReelInlinePanel");

  var focusRow = $("invKeyFocusRow");
  var signBtn  = $("invQtyKeySignMinus");

  if (mode === "item") {
    invQtyKeypadMode = "qty";
    invLastBulkEventId = null;
    invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
    invKeypadTargetEl = null;
    if (kp) { kp.className = kp.className.replace(/\bmode-\w+/g,"").trim() + " mode-qty"; }
    if (focusRow) focusRow.classList.add("hidden");
    if (signBtn)  signBtn.style.display = "";
    var titleEl = $("invQtyKeypadTitle"); if (titleEl) titleEl.textContent = "Quantity";
    var applyBtn = $("invQtyKeyApplyBtn"); if (applyBtn) applyBtn.textContent = "✓ Apply";
    var lbl = $("invQtyDisplayLabel"); if (lbl) lbl.textContent = "Qty:";
    var disp = $("invQtyDisplay"); if (disp) { disp.textContent = "1"; disp.className = "inv-qty-display"; }
    var ctx = $("invQtyKeypadContext"); if (ctx) ctx.textContent = "Scan an item to begin. Tip: press Tab after scanning, then type qty + Enter.";
    if (rip) rip.classList.add("hidden");

  } else if (mode === "reel") {
    invQtyKeypadMode = "reel";
    invLastBulkEventId = null;
    invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
    invKeypadTargetEl = null;
    if (kp) { kp.className = kp.className.replace(/\bmode-\w+/g,"").trim() + " mode-reel"; }
    if (focusRow) focusRow.classList.remove("hidden");
    if (signBtn)  signBtn.style.display = "none";
    var titleEl = $("invQtyKeypadTitle"); if (titleEl) titleEl.textContent = "Reel Entry";
    var applyBtn = $("invQtyKeyApplyBtn"); if (applyBtn) applyBtn.textContent = "✓ Save Reel";
    var lbl = $("invQtyDisplayLabel"); if (lbl) lbl.textContent = "→";
    // Show reel entry panel inline with cleared fields
    if (rip) { rip.classList.remove("hidden"); invClearReelFields(); }
    invQtyKeypadRefreshReelTarget();

  } else {
    // auto / serial — save any pending reel, show qty keypad like item mode
    invAutoSaveReelInline();
    invQtyKeypadMode = "qty";
    invLastBulkEventId = null;
    invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
    invKeypadTargetEl = null;
    if (kp) { kp.className = kp.className.replace(/\bmode-\w+/g,"").trim() + " mode-qty"; }
    if (rip) rip.classList.add("hidden");
    if (focusRow) focusRow.classList.add("hidden");
    if (signBtn)  signBtn.style.display = "";
    var titleEl = $("invQtyKeypadTitle"); if (titleEl) titleEl.textContent = "Quantity";
    var applyBtn = $("invQtyKeyApplyBtn"); if (applyBtn) applyBtn.textContent = "✓ Apply";
    var lbl = $("invQtyDisplayLabel"); if (lbl) lbl.textContent = "Qty:";
    var disp = $("invQtyDisplay"); if (disp) { disp.textContent = "1"; disp.className = "inv-qty-display"; }
    var ctx = $("invQtyKeypadContext"); if (ctx) ctx.textContent = "Scan an item to begin. Tip: press Tab after scanning, then type qty + Enter.";
  }

  renderInvStatusBar();
  setTimeout(function() { var i = $("invScanInput"); if (i) i.focus(); }, 50);
}

function invToggleModeBarcodes() {
  var panel = $("invModeBarcodes");
  if (!panel) return;
  var hidden = panel.classList.toggle("hidden");
  var btn = document.querySelector("[onclick='invToggleModeBarcodes()']");
  if (btn) btn.textContent = "Mode Barcodes " + (hidden ? "▾" : "▴");
}

// ===================================================================
// SOFT QUANTITY KEYPAD
// ===================================================================

function invShowQtyKeypad(eventId, itemNumber, description) {
  invLastBulkEventId = eventId;
  invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
  var display = $("invQtyDisplay");
  if (display) { display.textContent = "1"; display.className = "inv-qty-display"; }
  var ctx = $("invQtyKeypadContext");
  if (ctx) ctx.textContent = (itemNumber || "Item") + (description ? " — " + description : "") + "  ·  ×1 applied — adjust or scan next";
}

function invShowLockedKeypad() {
  invLastBulkEventId = null;
  invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
  var display = $("invQtyDisplay");
  if (display) { display.textContent = "1"; display.className = "inv-qty-display"; }
  var ctx = $("invQtyKeypadContext");
  if (ctx) ctx.textContent = "Serialized item — quantity is always 1";
}

function invHideQtyKeypad() {
  // Keypad always stays visible; just reset its state
  invLastBulkEventId = null;
  invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
  invKeypadTargetEl = null;
  if (invScanMode === "reel") {
    invQtyKeypadRefreshReelTarget();
  } else {
    var display = $("invQtyDisplay");
    if (display) { display.textContent = "1"; display.className = "inv-qty-display"; }
    var ctx = $("invQtyKeypadContext");
    if (ctx) ctx.textContent = "Scan an item to begin. Tip: press Tab after scanning, then type qty + Enter.";
  }
}

function invQtyRefreshDisplay() {
  var display = $("invQtyDisplay");
  if (!display) return;
  display.textContent = invQtyKeypadValue || "0";
  var n = parseInt(invQtyKeypadValue, 10);
  display.className = "inv-qty-display" + (n < 0 ? " negative" : "");
}

function invQtyKeypadRefreshReelTarget() {
  var display = $("invQtyDisplay");
  var ctx     = $("invQtyKeypadContext");

  document.querySelectorAll(".inv-reel-keypad-targeted").forEach(function(el) {
    el.classList.remove("inv-reel-keypad-targeted");
  });
  document.querySelectorAll(".inv-key-focus.targeted").forEach(function(b) {
    b.classList.remove("targeted");
  });

  if (invKeypadTargetEl) {
    if (display) { display.textContent = invKeypadTargetEl.value || "0"; display.className = "inv-qty-display"; }
    invKeypadTargetEl.classList.add("inv-reel-keypad-targeted");
    var lbl = invKeypadTargetEl.getAttribute("data-reel-label") || invKeypadTargetEl.id;
    if (ctx) ctx.textContent = "→ " + lbl;

    // Highlight matching focus-jump button
    var focusMap = {
      invReelNumber: "reel", invReelItemNumber: "item",
      invReelInnerA: "inner", invReelInnerB: "inner",
      invReelOuterA: "outer", invReelOuterB: "outer"
    };
    var targetType = focusMap[invKeypadTargetEl.id];
    if (targetType) {
      var btn = document.querySelector(".inv-key-focus[data-target='" + targetType + "']");
      if (btn) btn.classList.add("targeted");
    }
  } else {
    if (display) { display.textContent = "—"; display.className = "inv-qty-display"; }
    if (ctx) ctx.textContent = "Tap a field or use focus buttons above.";
  }
}

function invQtyKeyDigit(d) {
  if (invQtyKeypadMode === "reel") {
    if (!invKeypadTargetEl) return;
    invKeypadTargetEl.value = (invKeypadTargetEl.value || "") + d;
    invKeypadTargetEl.dispatchEvent(new Event("input"));
    invQtyKeypadRefreshReelTarget();
    invKeypadTargetEl.focus();
    return;
  }
  // qty mode — replace the default "1" on first digit press only
  if (invQtyKeypadFresh) {
    var sign = invQtyKeypadValue.charAt(0) === "-" ? "-" : "";
    invQtyKeypadValue = sign + d;
    invQtyKeypadFresh = false;
  } else {
    var digits = invQtyKeypadValue.replace(/[^0-9]/g, "");
    if (digits.length + d.length > 6) return;
    invQtyKeypadValue += d;
  }
  invQtyRefreshDisplay();
}

function invQtyKeySign() {
  if (invQtyKeypadMode === "reel") return;
  invQtyKeypadValue = invQtyKeypadValue.charAt(0) === "-"
    ? invQtyKeypadValue.slice(1)
    : "-" + invQtyKeypadValue;
  invQtyRefreshDisplay();
}

function invKeyFocusField(target) {
  var el = null;
  if (target === "reel")   { el = $("invReelNumber"); }
  else if (target === "item")   { el = $("invReelItemNumber"); }
  else if (target === "inner")  { el = $("invReelInnerA"); }
  else if (target === "outer")  { el = $("invReelOuterA"); }
  else if (target === "inner2") { el = $("invReelInnerB"); }
  else if (target === "outer2") { el = $("invReelOuterB"); }
  if (!el) return;
  invKeypadTargetEl = el;
  el.focus();
  invQtyKeypadRefreshReelTarget();
}

function invQtyKeyBackspace() {
  if (invQtyKeypadMode === "reel") {
    if (!invKeypadTargetEl) return;
    invKeypadTargetEl.value = String(invKeypadTargetEl.value || "").slice(0, -1);
    invKeypadTargetEl.dispatchEvent(new Event("input"));
    invQtyKeypadRefreshReelTarget();
    invKeypadTargetEl.focus();
    return;
  }
  if (invQtyKeypadValue.length <= 1) {
    invQtyKeypadValue = "1";
  } else {
    invQtyKeypadValue = invQtyKeypadValue.slice(0, -1);
    if (invQtyKeypadValue === "-") invQtyKeypadValue = "1";
  }
  invQtyRefreshDisplay();
}

function invQtyKeyClear() {
  if (invQtyKeypadMode === "reel") {
    if (!invKeypadTargetEl) return;
    invKeypadTargetEl.value = "";
    invKeypadTargetEl.dispatchEvent(new Event("input"));
    invQtyKeypadRefreshReelTarget();
    invKeypadTargetEl.focus();
    return;
  }
  invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
  invQtyRefreshDisplay();
}

function invEnterQtyMode() {
  var kp = $("invQtyKeypad");
  if (kp) kp.classList.add("qty-active");
  var disp = $("invQtyDisplay");
  if (disp) disp.classList.add("qty-active");
  var ctx = $("invQtyKeypadContext");
  if (ctx) ctx.textContent = "⌨  Ready for quantity — type digits, then Enter";
  var si = $("invScanInput");
  if (si) si.blur();
}

function invExitQtyMode() {
  var kp = $("invQtyKeypad");
  if (kp) kp.classList.remove("qty-active");
  var disp = $("invQtyDisplay");
  if (disp) disp.classList.remove("qty-active");
  var si = $("invScanInput");
  if (si) {
    si.classList.remove("scan-ready");
    void si.offsetWidth;
    si.classList.add("scan-ready");
    setTimeout(function() { si.classList.remove("scan-ready"); }, 750);
  }
}

function invQtyKeySkip() {
  invExitQtyMode();
  invLastBulkEventId = null;
  invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
  if (invScanMode === "reel") {
    invKeypadTargetEl = null;
    invQtyKeypadRefreshReelTarget();
  } else {
    invQtyRefreshDisplay();
    var ctx = $("invQtyKeypadContext"); if (ctx) ctx.textContent = "Scan an item to begin. Tip: press Tab after scanning, then type qty + Enter.";
  }
  setTimeout(function() { var i = $("invScanInput"); if (i) { i.focus(); i.select(); } }, 50);
}

function invQtyKeyApply() {
  if (invQtyKeypadMode === "reel") {
    invSubmitReelEntry();
    return;
  }
  var n = parseInt(invQtyKeypadValue, 10);
  if (isNaN(n)) { invQtyKeyClear(); return; }

  var evt = invEvents.find(function(e) { return e.eventId === invLastBulkEventId; });
  if (!evt) {
    invSetScanFeedback("No item active — scan a bulk item first, then adjust qty.", "warn");
    invQtyKeyClear();
    return;
  }

  evt.qty = n;
  invSession.updatedAt = invNow();
  scheduleInvAutosave();
  renderInvEventLog();
  renderInvSummary();

  var label = n > 0 ? "+" + n : String(n);
  invSetScanFeedback(
    "Qty updated to " + label + " for " + (evt.itemNumber || "item") +
    (evt.description ? " (" + evt.description + ")" : "") + ".", "ok");

  // Reset for next item — keypad stays visible in item mode
  invExitQtyMode();
  invLastBulkEventId = null;
  invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
  invQtyRefreshDisplay();
  var ctx = $("invQtyKeypadContext"); if (ctx) ctx.textContent = "Qty updated — scan next item.";
  setTimeout(function() { var i = $("invScanInput"); if (i) { i.focus(); i.select(); } }, 50);
}

// -- Main scan entry point -----------------------------------------
function invProcessScan() {
  if (!invSession) {
    invSetScanFeedback("Start a session first.", "error");
    return;
  }
  var rawValue = sanitizeScannerValue($("invScanInput").value || "", { uppercase: true });
  if (!rawValue) { $("invScanInput").focus(); return; }

  // Dismiss any open qty keypad (don't apply — user chose to scan something new)
  invHideQtyKeypad();

  timUnlockAudio();

  // Mode-switch barcodes: ##MAUTO, ##MSERIAL, ##MREEL, ##MITEM
  var modeSwitchMap = { "##MAUTO": "auto", "##MSERIAL": "serial", "##MREEL": "reel", "##MITEM": "item" };
  if (modeSwitchMap[rawValue]) {
    invSetScanMode(modeSwitchMap[rawValue]);
    var modeLabels = { auto: "Auto-Detect", serial: "Serial / FSAN", reel: "Cable Reel", item: "Item # (Bulk)" };
    var newLabel = modeLabels[modeSwitchMap[rawValue]];
    var fb = $("invScanFeedback");
    if (fb) { fb.textContent = "Mode: " + newLabel; fb.className = "inv-scan-feedback ok"; }
    invAddActivity("mode", "Mode → " + newLabel);
    $("invScanInput").value = "";
    invUpdateDetectedBadge("");
    return;
  }

  var override    = $("invScanTypeOverride") ? $("invScanTypeOverride").value : "";
  var scanType    = override || invClassifyScan(rawValue);
  // Location barcodes always take priority over any mode override
  if (invClassifyScan(rawValue) === "location") scanType = "location";
  var contextItem = sanitizeScannerValue($("invScanItem") ? $("invScanItem").value || "" : "", { uppercase: true });
  var notes       = $("invScanNotes") ? ($("invScanNotes").value || "").trim() : "";

  // In serial mode with no override, default unknown scans to serial
  if (invScanMode === "serial" && !override && scanType === "unknown") {
    scanType = "serial";
  }
  // In item mode with no override, treat any non-location scan as a bulk item number
  if (invScanMode === "item" && !override && scanType !== "location") {
    scanType = "item_number";
  }
  // In reel mode with no override, unknown scans default to reel_number
  if (invScanMode === "reel" && !override && scanType === "unknown") {
    scanType = "reel_number";
  }

  // Location scan: update sticky location and return
  if (scanType === "location") {
    invSetLocation(rawValue);
    var fb = $("invScanFeedback");
    if (fb) { fb.textContent = "Location → " + rawValue; fb.className = "inv-scan-feedback ok"; }
    invAddActivity("location", "Location → " + rawValue, "", "location");
    $("invScanInput").value = "";
    invUpdateDetectedBadge("");
    setTimeout(function() { $("invScanInput").focus(); }, 50);
    return;
  }

  // Qty is always 1 at scan time for bulk items; keypad adjusts it afterward
  var qty = 1;

  var ok = false;
  if (scanType === "serial" || scanType === "fsan") {
    ok = invHandleSerializedScan(rawValue, scanType, contextItem, notes, invCurrentLocation);
  } else if (scanType === "box_id") {
    ok = invHandleBoxScan(rawValue, contextItem, notes, invCurrentLocation);
  } else if (scanType === "item_number") {
    // In reel mode, item number scans prefill the reel entry item field
    // In auto mode, reel-tracked products open the reel entry panel instead of bulk counting
    var _reelRouteMatch = invScanMode === "reel" ? true
      : (function() { var m = findProductMapMatch(rawValue); return m && m.entry && m.entry.tracking_type === "reel"; }());
    if (_reelRouteMatch) {
      invPrefillReelItemNumber(rawValue, notes, invCurrentLocation);
      return;
    }
    ok = invHandleBulkCount(rawValue, qty, notes, invCurrentLocation);
  } else if (scanType === "barcode") {
    var resolvedItem = BARCODE_MAP[normKey(rawValue)];
    ok = invHandleBulkCount(resolvedItem, qty, notes, invCurrentLocation);
  } else if (scanType === "mac") {
    ok = invHandleMacScan(rawValue, contextItem, notes, invCurrentLocation);
  } else if (scanType === "reel_number") {
    invHandleReelScan(rawValue, notes, invCurrentLocation);
    return; // inline panel takes over; it clears scan input on submit
  } else {
    invCreateExceptionEvent(rawValue, "unknown",
      "Scan type could not be determined",
      "Select a scan mode or use the hidden type override to manually classify this scan.",
      notes);
    invSetScanFeedback("Unknown scan: \"" + rawValue + "\" — exception created. Select a mode or check the value.", "warn");
    ok = false;
  }

  if (ok) {
    $("invScanInput").value = "";
    invShowScanMeta(invGetScanMeta(scanType, rawValue));
    if ((scanType === "item_number" || scanType === "barcode") && invLastBulkEventId) {
      var bulkEvt = invEvents.find(function(e) { return e.eventId === invLastBulkEventId; });
      if (bulkEvt) invShowQtyKeypad(invLastBulkEventId, bulkEvt.itemNumber || rawValue, bulkEvt.description || "");
    } else if (scanType === "serial" || scanType === "fsan" || scanType === "mac") {
      invShowLockedKeypad();
    } else {
      // box_id and others — reset to idle
      invLastBulkEventId = null;
      invQtyKeypadValue = "1"; invQtyKeypadFresh = true;
      var disp = $("invQtyDisplay"); if (disp) { disp.textContent = "1"; disp.className = "inv-qty-display"; }
      var ctx = $("invQtyKeypadContext"); if (ctx) ctx.textContent = "Scan an item to begin. Tip: press Tab after scanning, then type qty + Enter.";
    }
  }
  invUpdateDetectedBadge("");
  // select() after every scan — on success the field is empty (harmless),
  // on failure the bad value is selected so the next scan overwrites it
  setTimeout(function() { var si = $("invScanInput"); si.focus(); si.select(); }, 50);
}

function invGetScanMeta(scanType, rawValue) {
  if (scanType === "item_number") {
    var mm = findProductMapMatch(rawValue);
    return { type: "item_number", itemNumber: rawValue, description: mm ? getMapDescription(mm.entry) : "" };
  }
  if (scanType === "barcode") {
    var resolved = BARCODE_MAP[normKey(rawValue)] || rawValue;
    var mm2 = findProductMapMatch(resolved);
    return { type: "barcode", itemNumber: resolved, description: mm2 ? getMapDescription(mm2.entry) : "" };
  }
  if (scanType === "serial") {
    var rec = invResolveBySerial(normKey(rawValue));
    var inum = rec ? (rec.item_number || rec.product || "") : "";
    var mm3 = inum ? findProductMapMatch(inum) : null;
    return { type: "serial", itemNumber: inum, description: mm3 ? getMapDescription(mm3.entry) : "", notFound: !rec };
  }
  if (scanType === "fsan") {
    var rec2 = invResolveByFsan(normKey(rawValue));
    var inum2 = rec2 ? (rec2.item_number || rec2.product || "") : "";
    var mm4 = inum2 ? findProductMapMatch(inum2) : null;
    return { type: "fsan", itemNumber: inum2, description: mm4 ? getMapDescription(mm4.entry) : "", notFound: !rec2 };
  }
  if (scanType === "mac") {
    var macBare = rawValue.replace(/[:\-\.]/g, "").toUpperCase();
    var rec3 = invResolveByMac(macBare);
    var inum3 = rec3 ? (rec3.item_number || rec3.product || "") : "";
    var mm5 = inum3 ? findProductMapMatch(inum3) : null;
    return { type: "mac", itemNumber: inum3, description: mm5 ? getMapDescription(mm5.entry) : "", notFound: !rec3 };
  }
  return null;
}

function invShowScanMeta(meta) {
  var row = $("invScanMetaRow");
  if (!row || !meta) return;
  var typeLabel = { item_number: "item", barcode: "barcode→item", serial: "serial", fsan: "fsan", mac: "mac" }[meta.type] || meta.type;
  var html = '<span class="inv-meta-type">' + typeLabel + '</span>';
  if (meta.itemNumber) {
    html += ' <span class="inv-meta-sep">·</span> <span class="inv-meta-item">' + escapeHtml(meta.itemNumber) + '</span>';
  } else if (meta.notFound) {
    html += ' <span class="inv-meta-sep">·</span> <span class="inv-meta-notfound">not in history</span>';
  }
  if (meta.description) {
    html += ' <span class="inv-meta-sep">—</span> <span class="inv-meta-desc">' + escapeHtml(meta.description) + '</span>';
  }
  row.innerHTML = html;
  row.style.display = "flex";
}

function invHideScanMeta() {
  var row = $("invScanMetaRow");
  if (row) { row.innerHTML = ""; row.style.display = "none"; }
}

function invClearScanInput() {
  $("invScanInput").value = "";
  invSetScanFeedback("Ready. Scan a barcode or type a value.", "info");
  invUpdateDetectedBadge("");
  invHideScanMeta();
  $("invScanInput").focus();
}

// -- Exceptions renderer -------------------------------------------
function renderInvExceptions() {
  var tbody = $("invExceptionsBody");
  var countEl = $("invExceptionCount");
  if (!tbody) return;

  var exceptions = invEvents.filter(function(e) { return e.eventType === "exception"; });
  if (countEl) countEl.textContent = exceptions.length + " exception(s)";

  if (!exceptions.length) {
    tbody.innerHTML = "<tr><td colspan=\"7\" style=\"text-align:center;color:#94a3b8;padding:16px;\">No exceptions.</td></tr>";
    return;
  }

  tbody.innerHTML = exceptions.slice().reverse().map(function(e) {
    var voided = e.status === "voided";
    return "<tr class=\"" + (voided ? "warn" : "block") + "\">" +
      "<td>" + (e.sequence || "") + "</td>" +
      "<td style=\"white-space:nowrap\">" + invFormatTime(e.timestamp) + "</td>" +
      "<td>" + escapeHtml(e.scannedValue    || "") + "</td>" +
      "<td>" + escapeHtml(e.problem         || "") + "</td>" +
      "<td>" + escapeHtml(e.suggestedAction || "") + "</td>" +
      "<td><span class=\"pill " + (voided ? "warn" : "block") + "\">" + escapeHtml(e.status || "") + "</span></td>" +
      "<td>" + escapeHtml(e.notes           || "") + "</td>" +
      "</tr>";
  }).join("");
}

// ===================================================================
// INVENTORY MODE — Phase 4: Cable Reel Inventory
// ===================================================================

var invReelModalScannedValue = "";

// ── Reel ID conflict detection ─────────────────────────────────────────────
// Checks whether any reel-tracked item number in the product map also appears
// as a reelNumber in scan event history. Called after product map or session
// events change so operators see the problem before scanning begins.
function checkReelItemConflicts() {
  var reelItems = Object.keys(PRODUCT_MAP).filter(function(k) {
    return PRODUCT_MAP[k] && PRODUCT_MAP[k].tracking_type === "reel";
  });
  if (!reelItems.length) {
    invReelIdConflicts = [];
    renderReelIdConflictBanner();
    return;
  }
  var usedAsReel = {};
  (invEvents || []).concat(appData.inventory_events || []).forEach(function(e) {
    if (e.eventType === "cable_reel_count" && e.reelNumber) {
      usedAsReel[normKey(e.reelNumber)] = true;
    }
  });
  invReelIdConflicts = reelItems.filter(function(k) { return usedAsReel[normKey(k)]; });
  renderReelIdConflictBanner();
}

function renderReelIdConflictBanner() {
  var banner = $("invReelIdConflictBanner");
  if (!banner) return;
  if (!invReelIdConflicts.length) { banner.style.display = "none"; return; }
  var textEl = $("invReelIdConflictText");
  if (textEl) {
    var quoted = invReelIdConflicts.map(function(c) { return "“" + c + "”"; });
    textEl.textContent = invReelIdConflicts.length === 1
      ? quoted[0] + " is both a reel-tracked item number and a reel number in scan history — verify your reel numbering convention."
      : quoted.join(", ") + " appear as both reel-tracked item numbers and reel numbers in scan history — verify your reel numbering convention.";
  }
  banner.style.display = "flex";
}

function invDismissReelIdConflictBanner() {
  var banner = $("invReelIdConflictBanner");
  if (banner) banner.style.display = "none";
}
// ──────────────────────────────────────────────────────────────────────────

function invHandleReelScan(reelNumber, notes, location) {
  // Auto-save any current inline entry before populating the new reel
  invAutoSaveReelInline();
  invOpenReelModal(reelNumber, notes, location);
}

// Called when an item-number scan resolves to a reel-tracked product (auto mode)
// or any item-number scan in cable reel mode. Prefills the item field and waits
// for a reel number scan to complete the entry.
function invPrefillReelItemNumber(itemNumber, notes, location) {
  var rip = $("invReelInlinePanel");
  if (rip) { rip.classList.remove("hidden"); rip.dataset.location = location || ""; }

  var itemField = $("invReelItemNumber");
  if (itemField) { itemField.value = itemNumber; itemField.classList.remove("inv-reel-prefilled"); }

  var mapMatch = findProductMapMatch(itemNumber);
  var rd = mapMatch && mapMatch.entry ? mapMatch.entry.reel_direction : null;
  var spanSel = $("invReelSpanType");
  if (spanSel) spanSel.value = (rd === "two_way") ? "two_way" : "single";
  invReelSpanTypeChange();
  invCalcReelFt();

  setTimeout(function() {
    var reelField = $("invReelNumber");
    if (reelField) { invKeypadTargetEl = reelField; reelField.focus(); }
    invQtyKeypadRefreshReelTarget();
  }, 50);

  var ctx = $("invQtyKeypadContext");
  if (ctx) ctx.textContent = "Item: " + itemNumber + " · Scan reel number.";

  // Scan-time secondary guard: warn if this value has also been recorded as a reel number
  var conflictNote = $("invReelConflictNote");
  if (conflictNote) {
    var seenAsReel = invEvents.some(function(e) {
      return e.eventType === "cable_reel_count" && normKey(e.reelNumber || "") === normKey(itemNumber);
    });
    if (seenAsReel) {
      conflictNote.textContent = "⚠️ “" + itemNumber + "” has been recorded as a reel number in this session — confirm this is the item number, not the reel number.";
      conflictNote.style.display = "block";
    } else {
      conflictNote.style.display = "none";
    }
  }

  var fb = $("invScanFeedback");
  if (fb) { fb.textContent = "Item: " + itemNumber + " — scan reel number."; fb.className = "inv-scan-feedback ok"; }
  invAddActivity("ok", "Reel item: " + itemNumber, "", "reel");

  var inp = $("invScanInput");
  if (inp) inp.value = "";
  setTimeout(function() { var i = $("invScanInput"); if (i) i.focus(); }, 100);
}

function invAutoSaveReelInline() {
  var rip = $("invReelInlinePanel");
  if (!rip || rip.classList.contains("hidden")) return;
  var itemNumber = ($("invReelItemNumber") ? $("invReelItemNumber").value || "" : "").trim().toUpperCase();
  var reelNumber = ($("invReelNumber")     ? $("invReelNumber").value     || "" : "").trim().toUpperCase();
  var innerA = parseFloat($("invReelInnerA") ? $("invReelInnerA").value : "") || 0;
  var outerA = parseFloat($("invReelOuterA") ? $("invReelOuterA").value : "") || 0;
  if (!itemNumber || !reelNumber || (!innerA && !outerA)) return; // incomplete — discard silently
  invSubmitReelEntry(true); // silent = no alerts
}

function invOpenReelModal(reelNumber, notes, location) {
  invReelModalScannedValue = reelNumber || "";

  var reelField = $("invReelNumber");
  var itemField = $("invReelItemNumber");
  if (reelField) reelField.value = reelNumber || "";
  if (itemField) itemField.value = sanitizeScannerValue(
    $("invScanItem") ? ($("invScanItem").value || "") : "", { uppercase: true });

  // Clear all pre-fillable fields and remove any prefill marker
  ["invReelInnerA","invReelOuterA","invReelFtA","invReelInnerB","invReelOuterB","invReelFtB"].forEach(function(id) {
    var el = $(id); if (el) { el.value = ""; el.classList.remove("inv-reel-prefilled"); }
  });
  if (reelField) reelField.classList.remove("inv-reel-prefilled");
  if (itemField) itemField.classList.remove("inv-reel-prefilled");

  // Pre-populate from the last known entry for this reel, marking pre-filled fields
  var itemNum = itemField ? itemField.value.trim().toUpperCase() : "";
  var reelNum = reelField ? reelField.value.trim().toUpperCase() : "";

  // Reverse lookup: if item is blank but reel is known, find item from master events
  if (!itemNum && reelNum) {
    var master = invFindReelMaster(reelNum);
    if (master && master.itemNumber) {
      itemNum = master.itemNumber.trim().toUpperCase();
      if (itemField) { itemField.value = itemNum; itemField.classList.add("inv-reel-prefilled"); }
    }
  }

  var prev = invGetReelHistory(itemNum, reelNum);
  if (prev) {
    var setAndMark = function(id, val) {
      var el = $(id);
      if (el && val !== "" && val != null) { el.value = val; el.classList.add("inv-reel-prefilled"); }
    };
    setAndMark("invReelInnerA", prev.innerSeqA);
    setAndMark("invReelOuterA", prev.outerSeqA);
    $("invReelSpanType").value = (prev.spanType === "two_way") ? "two_way" : "single";
    if (prev.spanType === "two_way") {
      setAndMark("invReelInnerB", prev.innerSeqB);
      setAndMark("invReelOuterB", prev.outerSeqB);
    }
  } else {
    var mapMatch = findProductMapMatch(itemNum);
    var rd = mapMatch && mapMatch.entry ? mapMatch.entry.reel_direction : null;
    $("invReelSpanType").value = (rd === "two_way") ? "two_way" : "single";
  }

  var notesEl = $("invReelNotes");
  if (notesEl) notesEl.value = notes || "";
  invReelSpanTypeChange();
  invCalcReelFt();

  var rip = $("invReelInlinePanel");
  if (rip) {
    rip.dataset.location = location || "";
    rip.classList.remove("hidden");
  }

  // Update keypad context
  var ctx = $("invQtyKeypadContext");
  if (ctx) ctx.textContent = "Reel: " + (reelNum || reelNumber) + (itemNum ? " · " + itemNum : "");

  // Auto-focus: first unfilled required field, or Save button if everything is pre-filled
  setTimeout(function() {
    var required = [$("invReelItemNumber"), $("invReelInnerA"), $("invReelOuterA")];
    var firstEmpty = null;
    for (var i = 0; i < required.length; i++) {
      if (required[i] && !required[i].value) { firstEmpty = required[i]; break; }
    }
    var f = firstEmpty || $("invReelSaveBtn");
    if (f) {
      f.focus();
      if (f !== $("invReelSaveBtn")) {
        invKeypadTargetEl = f;
        invQtyKeypadRefreshReelTarget();
      }
    }
  }, 50);
}

function invReelUpdateSpanTypeFromContext() {
  var itemField = $("invReelItemNumber");
  var reelField = $("invReelNumber");
  var itemNum = itemField ? itemField.value.trim().toUpperCase() : "";
  var reelNum = reelField ? reelField.value.trim().toUpperCase() : "";
  var spanSel = $("invReelSpanType");
  if (!spanSel) return;

  // Reverse lookup: if item is blank but reel is known, find item from master events
  if (!itemNum && reelNum) {
    var master = invFindReelMaster(reelNum);
    if (master && master.itemNumber) {
      itemNum = master.itemNumber.trim().toUpperCase();
      if (itemField) { itemField.value = itemNum; itemField.classList.add("inv-reel-prefilled"); }
    }
  }

  var prev = invGetReelHistory(itemNum, reelNum);
  if (prev) {
    spanSel.value = (prev.spanType === "two_way") ? "two_way" : "single";
  } else if (itemNum) {
    var match = findProductMapMatch(itemNum);
    var rd = match && match.entry ? match.entry.reel_direction : null;
    spanSel.value = (rd === "two_way") ? "two_way" : "single";
  } else {
    spanSel.value = "single";
  }

  invReelSpanTypeChange();
}

function invReelSpanTypeChange() {
  var spanType = $("invReelSpanType") ? $("invReelSpanType").value : "single";
  var spanB = $("invReelSpanBSection");
  if (spanB) spanB.style.display = spanType === "two_way" ? "block" : "none";
  invCalcReelFt();
}

function invCalcReelFt() {
  var innerA = parseFloat($("invReelInnerA") ? $("invReelInnerA").value : "") || 0;
  var outerA = parseFloat($("invReelOuterA") ? $("invReelOuterA").value : "") || 0;
  var ftA    = Math.abs(outerA - innerA);
  if ($("invReelFtA")) $("invReelFtA").value = (innerA || outerA) ? ftA : "";

  var spanType = $("invReelSpanType") ? $("invReelSpanType").value : "single";
  var totalFt  = ftA;

  if (spanType === "two_way") {
    var innerB = parseFloat($("invReelInnerB") ? $("invReelInnerB").value : "") || 0;
    var outerB = parseFloat($("invReelOuterB") ? $("invReelOuterB").value : "") || 0;
    var ftB    = Math.abs(outerB - innerB);
    if ($("invReelFtB")) $("invReelFtB").value = (innerB || outerB) ? ftB : "";
    totalFt = ftA + ftB;
  }

  var totalEl = $("invReelTotalFt");
  if (totalEl) totalEl.textContent = totalFt ? totalFt.toLocaleString() + " ft" : "—";

  var itemNum = $("invReelItemNumber") ? $("invReelItemNumber").value.trim().toUpperCase() : "";
  var reelNum = $("invReelNumber")     ? $("invReelNumber").value.trim().toUpperCase()     : "";
  invReelUpdateHistoryPanel(itemNum, reelNum, totalFt || null);
}

function invReelUpdateHistoryPanel(itemNum, reelNum, currentFt) {
  var panel = $("invReelHistoryPanel");
  var tbody = $("invReelHistoryBody");
  if (!panel || !tbody) return;

  if (!itemNum && !reelNum) { panel.style.display = "none"; return; }

  var prev = invGetReelHistory(itemNum, reelNum);
  if (!prev) { panel.style.display = "none"; return; }

  panel.style.display = "block";
  var prevFt = prev.totalAvailableFt || 0;
  var diff   = currentFt != null ? currentFt - prevFt : null;
  var diffStr   = diff != null ? (diff >= 0 ? "+" : "") + diff.toLocaleString() + " ft" : "—";
  var diffColor = diff == null ? "#475569" : diff < 0 ? "#dc2626" : diff > 0 ? "#16a34a" : "#475569";

  tbody.innerHTML = "<tr>" +
    "<td style='padding:4px 12px 4px 0;font-weight:700'>" + prevFt.toLocaleString() + " ft</td>" +
    "<td style='padding:4px 12px 4px 0;font-weight:700'>" + (currentFt != null ? currentFt.toLocaleString() + " ft" : "—") + "</td>" +
    "<td style='padding:4px 12px 4px 0;font-weight:700;color:" + diffColor + "'>" + diffStr + "</td>" +
    "<td style='padding:4px 0;white-space:nowrap'>" + invFormatDateTime(prev.timestamp) + "</td>" +
    "</tr>";
}

function invFindReelMaster(reelNum) {
  var k2 = normKey(reelNum || "");
  if (!k2) return null;
  var all = (appData.inventory_events || []).concat(invEvents);
  var matches = all.filter(function(e) {
    return e.eventType === "cable_reel_count" &&
           e.status    !== "voided"           &&
           normKey(e.reelNumber || "") === k2;
  });
  if (!matches.length) return null;
  matches.sort(function(a, b) { return (a.timestamp || "") < (b.timestamp || "") ? -1 : 1; });
  return matches[matches.length - 1];
}

function invGetReelHistory(itemNum, reelNum) {
  var k1 = normKey(itemNum || "");
  var k2 = normKey(reelNum || "");
  var all = (appData.inventory_events || []).concat(invEvents);
  var matches = all.filter(function(e) {
    return e.eventType === "cable_reel_count" &&
           e.status    !== "voided"           &&
           normKey(e.itemNumber || "") === k1  &&
           normKey(e.reelNumber  || "") === k2;
  });
  if (!matches.length) return null;
  matches.sort(function(a, b) { return (a.timestamp || "") < (b.timestamp || "") ? -1 : 1; });
  return matches[matches.length - 1];
}

function invSubmitReelEntry(silent) {
  var itemNumber = ($("invReelItemNumber").value || "").trim().toUpperCase();
  var reelNumber = ($("invReelNumber").value     || "").trim().toUpperCase();
  if (!itemNumber) { if (!silent) { alert("Item number is required."); $("invReelItemNumber").focus(); } return; }
  if (!reelNumber) { if (!silent) { alert("Reel number is required."); $("invReelNumber").focus();     } return; }

  var innerA = parseFloat($("invReelInnerA").value) || 0;
  var outerA = parseFloat($("invReelOuterA").value) || 0;
  if (!innerA && !outerA) { if (!silent) { alert("Enter at least one sequence value for Span A."); $("invReelInnerA").focus(); } return; }
  var ftA = Math.abs(outerA - innerA);

  var spanType = $("invReelSpanType").value || "single";
  var mm       = findProductMapMatch(itemNumber);
  var rip      = $("invReelInlinePanel");
  var location = (rip ? rip.dataset.location : "") || invCurrentLocation || "";
  var notes    = $("invReelNotes") ? ($("invReelNotes").value || "").trim() : "";

  var eventData = {
    scanType:         "reel_number",
    scannedValue:     invReelModalScannedValue || reelNumber,
    itemNumber:       itemNumber,
    description:      mm ? getMapDescription(mm.entry) : "",
    reelNumber:       reelNumber,
    location:         location,
    spanType:         spanType,
    innerSeqA:        innerA,
    outerSeqA:        outerA,
    availableFtA:     ftA,
    totalAvailableFt: ftA,
    notes:            notes
  };

  if (spanType === "two_way") {
    var innerB = parseFloat($("invReelInnerB").value) || 0;
    var outerB = parseFloat($("invReelOuterB").value) || 0;
    if (!innerB && !outerB) { if (!silent) { alert("Enter at least one sequence value for Span B, or switch to Single Span."); $("invReelInnerB").focus(); } return; }
    var ftB = Math.abs(outerB - innerB);
    eventData.innerSeqB        = innerB;
    eventData.outerSeqB        = outerB;
    eventData.availableFtB     = ftB;
    eventData.totalAvailableFt = ftA + ftB;
  }

  eventData.qty = eventData.totalAvailableFt;
  invCreateEvent("cable_reel_count", eventData);

  if (!silent) {
    invSetScanFeedback(
      "Reel " + reelNumber + " (" + itemNumber + "): " +
      eventData.totalAvailableFt.toLocaleString() + " ft recorded" +
      (spanType === "two_way" ? " (two spans)" : "") + ".", "ok", "", "reel");
  }
  invCloseReelInline();
  $("invScanInput").value = "";
}

function invClearReelFields() {
  ["invReelItemNumber","invReelNumber","invReelInnerA","invReelOuterA","invReelFtA",
   "invReelInnerB","invReelOuterB","invReelFtB"].forEach(function(id) {
    var el = $(id);
    if (el) { el.value = ""; el.classList.remove("inv-reel-prefilled"); }
  });
  var st = $("invReelSpanType"); if (st) st.value = "single";
  var sb = $("invReelSpanBSection"); if (sb) sb.style.display = "none";
  var notes = $("invReelNotes"); if (notes) notes.value = "";
  var hist  = $("invReelHistoryPanel"); if (hist) hist.style.display = "none";
  var total = $("invReelTotalFt"); if (total) total.textContent = "—";
  var cNote = $("invReelConflictNote"); if (cNote) cNote.style.display = "none";
  invReelModalScannedValue = "";
  // Pre-fill item # from sticky context if set
  var ctxItem = $("invScanItem");
  var itemFld = $("invReelItemNumber");
  if (ctxItem && ctxItem.value && itemFld) {
    itemFld.value = ctxItem.value.trim().toUpperCase();
  }
}

function invCloseReelInline() {
  invKeypadTargetEl = null;
  document.querySelectorAll(".inv-reel-keypad-targeted").forEach(function(el) {
    el.classList.remove("inv-reel-keypad-targeted");
  });
  if (invScanMode === "reel") {
    // Keep panel open — just clear fields for next entry
    invClearReelFields();
    var ctx = $("invQtyKeypadContext");
    if (ctx) ctx.textContent = "Scan a reel or fill fields below.";
    var disp = $("invQtyDisplay");
    if (disp) { disp.textContent = "—"; disp.className = "inv-qty-display"; }
  } else {
    var rip = $("invReelInlinePanel");
    if (rip) rip.classList.add("hidden");
    if (invQtyKeypadMode === "reel") {
      var ctx2 = $("invQtyKeypadContext");
      if (ctx2) ctx2.textContent = "Scan a reel to begin.";
      var disp2 = $("invQtyDisplay");
      if (disp2) { disp2.textContent = "—"; disp2.className = "inv-qty-display"; }
    }
  }
  setTimeout(function() { var i = $("invScanInput"); if (i) { i.focus(); i.select(); } }, 50);
}

function invDiscardReelEntry() {
  var scanned  = invReelModalScannedValue;
  var rip      = $("invReelInlinePanel");
  var loc      = (rip ? rip.dataset.location : "") || invCurrentLocation || "";
  invCloseReelInline();
  if (scanned) {
    invCreateEvent("exception", {
      scanType:     "reel_number",
      scannedValue: scanned,
      location:     loc,
      reason:       "Reel entry discarded by user"
    });
    invSetScanFeedback("Reel entry discarded — exception logged.", "warn");
  }
}

// ===================================================================
// PHASE 5 — UNKNOWN SERIAL INLINE PROMPT
// ===================================================================

var invSerialPromptScan = "";
var invSerialPromptType = "";
var invSerialPromptLoc  = "";
var invSerialPromptMode = "serialized"; // "serialized" | "bulk" | "reel"

function invShowSerialPrompt(scannedValue, scanType, location) {
  invSerialPromptScan = scannedValue || "";
  invSerialPromptType = scanType    || "serial";
  invSerialPromptLoc  = location    || invCurrentLocation || "";
  invSerialPromptMode = "serialized";

  var panel = $("invSerialPromptPanel");
  if (panel) panel.classList.remove("hidden");
  invRenderSerialPromptBody();
}

function invSetSerialPromptMode(mode) {
  invSerialPromptMode = mode;
  if (mode === "reel") {
    // Route directly to reel inline panel — close this prompt
    invHideSerialPrompt();
    invPrefillReelItemNumber("", "", invSerialPromptLoc || invCurrentLocation);
    // Pre-fill reel number field with the scanned value
    var rf = $("invReelNumber");
    if (rf) { rf.value = invSerialPromptScan; rf.classList.add("inv-reel-prefilled"); }
    invSetScanFeedback("Switched to Reel mode — fill in reel details.", "warn");
    return;
  }
  invRenderSerialPromptBody();
}

function invRenderSerialPromptBody() {
  var pills = $("invSerialPromptTypePills");
  var body  = $("invSerialPromptBody");
  if (!pills || !body) return;

  var modes = [
    { key: "serialized", label: "Serialized" },
    { key: "bulk",       label: "Bulk / Item #" },
    { key: "reel",       label: "Cable Reel" }
  ];
  pills.innerHTML = modes.map(function(m) {
    var active = m.key === invSerialPromptMode;
    return '<button onclick="invSetSerialPromptMode(\'' + m.key + '\')" style="padding:4px 12px;font-size:12px;border-radius:20px;border:1px solid ' +
      (active ? '#6366f1;background:#eef2ff;color:#3730a3;font-weight:600;' : '#cbd5e1;background:#f8fafc;color:#475569;') +
      'cursor:pointer;">' + m.label + '</button>';
  }).join("");

  if (invSerialPromptMode === "serialized") {
    body.innerHTML =
      '<p class="small" style="margin:0 0 8px;color:#713f12;">Not in history — fill in what you know and Commit, or Cancel to log an exception.</p>' +
      '<div class="inv-serial-prompt-grid">' +
        '<label>Serial Number' +
          '<input id="invSerialPromptSerial" type="text" placeholder="e.g. SN123456" autocomplete="off" style="text-transform:uppercase;" value="' +
          (invSerialPromptType === "serial" ? escapeHtml(invSerialPromptScan) : "") + '" /></label>' +
        '<label>FSAN' +
          '<input id="invSerialPromptFsan" type="text" placeholder="e.g. CXNK00A1B2C3" autocomplete="off" style="text-transform:uppercase;" value="' +
          (invSerialPromptType === "fsan" ? escapeHtml(invSerialPromptScan) : "") + '" /></label>' +
        '<label>MAC Address <span style="font-weight:400;">(optional)</span>' +
          '<input id="invSerialPromptMac" type="text" placeholder="AA:BB:CC:DD:EE:FF" autocomplete="off" style="text-transform:uppercase;" /></label>' +
        '<label>Notes <span style="font-weight:400;">(optional)</span>' +
          '<input id="invSerialPromptNotes" type="text" placeholder="e.g. found loose, no box" ' +
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();invCommitSerialPrompt();}" /></label>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button onclick="invCommitSerialPrompt()" style="flex:1;padding:9px;">Commit Device</button>' +
        '<button class="secondary" onclick="invCancelSerialPrompt()">Cancel / Exception</button>' +
      '</div>';
    setTimeout(function() {
      var sf = $("invSerialPromptSerial"), ff = $("invSerialPromptFsan");
      var toFocus = (sf && sf.value) ? ff : sf;
      if (toFocus) toFocus.focus();
    }, 50);

  } else if (invSerialPromptMode === "bulk") {
    // Move scanned value to Item # field
    var mm = findProductMapMatch(invSerialPromptScan);
    var desc = mm ? getMapDescription(mm.entry) : "";
    body.innerHTML =
      '<p class="small" style="margin:0 0 8px;color:#713f12;">Count as a bulk item. Item # pre-filled from your scan. Not in product map — will flag in report.</p>' +
      '<div class="inv-serial-prompt-grid">' +
        '<label>Item # *' +
          '<input id="invSerialPromptBulkItem" type="text" placeholder="e.g. 1190OFF" autocomplete="off" style="text-transform:uppercase;" value="' +
          escapeHtml(invSerialPromptScan) + '" /></label>' +
        '<label>Description <span style="font-weight:400;">(optional)</span>' +
          '<input id="invSerialPromptBulkDesc" type="text" placeholder="e.g. Splice enclosure" autocomplete="off" value="' +
          escapeHtml(desc) + '" /></label>' +
        '<label>Qty' +
          '<input id="invSerialPromptBulkQty" type="number" min="1" value="1" style="width:90px;" /></label>' +
        '<label>Notes <span style="font-weight:400;">(optional)</span>' +
          '<input id="invSerialPromptBulkNotes" type="text" placeholder="e.g. not in Odoo" ' +
          'onkeydown="if(event.key===\'Enter\'){event.preventDefault();invCommitSerialPromptBulk();}" /></label>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
        '<button onclick="invCommitSerialPromptBulk()" style="flex:1;padding:9px;">Commit Bulk Count</button>' +
        '<button class="secondary" onclick="invCancelSerialPrompt()">Cancel / Exception</button>' +
      '</div>';
    setTimeout(function() {
      var qi = $("invSerialPromptBulkQty"); if (qi) qi.focus();
    }, 50);
  }
}

function invHideSerialPrompt() {
  var panel = $("invSerialPromptPanel");
  if (panel) panel.classList.add("hidden");
  invSerialPromptScan = "";
  invSerialPromptType = "";
  invSerialPromptLoc  = "";
  invSerialPromptMode = "serialized";
  setTimeout(function() { var i = $("invScanInput"); if (i) { i.focus(); i.select(); } }, 50);
}

function invCommitSerialPrompt() {
  var serial = (($("invSerialPromptSerial") ? $("invSerialPromptSerial").value : "") || "").trim().toUpperCase();
  var fsan   = (($("invSerialPromptFsan")   ? $("invSerialPromptFsan").value   : "") || "").trim().toUpperCase();
  var mac    = (($("invSerialPromptMac")    ? $("invSerialPromptMac").value    : "") || "").trim().toUpperCase();
  var notes  = (($("invSerialPromptNotes")  ? $("invSerialPromptNotes").value  : "") || "").trim();
  var ctx    = sanitizeScannerValue($("invScanItem") ? $("invScanItem").value || "" : "", { uppercase: true });

  if (!serial && !fsan) {
    alert("Enter at least a Serial Number or FSAN.");
    var sf = $("invSerialPromptSerial"); if (sf) sf.focus();
    return;
  }

  var dup = invFindSerializedDuplicate(serial, fsan);
  if (dup) {
    invCreateExceptionEvent(serial || fsan, "serial",
      "Device already counted at " + invFormatTime(dup.timestamp) + " (event #" + dup.sequence + ")",
      "Review event #" + dup.sequence + ". Void it if scanned in error.", notes);
    invSetScanFeedback("DUPLICATE — already counted. Exception created.", "error");
    invHideSerialPrompt();
    return;
  }

  var itemNumber = ctx || "";
  var description = "";
  if (itemNumber) {
    var mm = findProductMapMatch(itemNumber);
    if (mm) description = getMapDescription(mm.entry);
  }

  var eventData = {
    scanType:     invSerialPromptType,
    scannedValue: invSerialPromptScan,
    serial:       serial,
    fsan:         fsan,
    itemNumber:   itemNumber,
    description:  description,
    location:     invSerialPromptLoc,
    qty:          1,
    notes:        notes || "Manual entry — not in history"
  };
  if (mac) eventData.mac = mac;
  invCreateEvent("serialized_device_scan", eventData);

  var ids = [];
  if (serial) ids.push("S/N: " + serial);
  if (fsan)   ids.push("FSAN: " + fsan);
  invSetScanFeedback("Committed (manual): " + ids.join("  "), "ok");
  $("invScanInput").value = "";
  invHideSerialPrompt();
}

function invCommitSerialPromptBulk() {
  var itemNumber = (($("invSerialPromptBulkItem") ? $("invSerialPromptBulkItem").value : "") || "").trim().toUpperCase();
  var description = (($("invSerialPromptBulkDesc") ? $("invSerialPromptBulkDesc").value : "") || "").trim();
  var qtyRaw = $("invSerialPromptBulkQty") ? $("invSerialPromptBulkQty").value : "1";
  var qty = parseInt(qtyRaw, 10);
  var notes = (($("invSerialPromptBulkNotes") ? $("invSerialPromptBulkNotes").value : "") || "").trim();

  if (!itemNumber) {
    alert("Item # is required.");
    var f = $("invSerialPromptBulkItem"); if (f) f.focus();
    return;
  }
  if (isNaN(qty) || qty < 1) { qty = 1; }

  // Check product map — if not found, log exception alongside the count
  var mm = findProductMapMatch(itemNumber);
  var resolvedDesc = mm ? getMapDescription(mm.entry) : description;

  if (!mm) {
    invCreateExceptionEvent(itemNumber, "item_number",
      "Item not found in product map — committed manually from unknown scan",
      "Add a product mapping for " + itemNumber + " if it belongs in Odoo.",
      notes);
  }

  var evt = invCreateEvent("bulk_quantity_count", {
    scanType:     "item_number",
    scannedValue: invSerialPromptScan,
    itemNumber:   itemNumber,
    description:  resolvedDesc,
    location:     invSerialPromptLoc,
    qty:          qty,
    notes:        notes || ("Manual bulk entry from unrecognized scan: " + invSerialPromptScan)
  });

  invLastBulkEventId = evt ? evt.eventId : null;
  invSetScanFeedback(
    "Bulk count committed: " + qty + "× " + itemNumber +
    (resolvedDesc ? " (" + resolvedDesc + ")" : "") +
    (!mm ? " — WARNING: not in product map, exception created." : ""),
    mm ? "ok" : "warn", "", mm ? "bulk" : "");

  if (invLastBulkEventId) {
    invShowQtyKeypad(invLastBulkEventId, itemNumber, resolvedDesc);
  }

  $("invScanInput").value = "";
  invHideSerialPrompt();
}

function invCancelSerialPrompt() {
  // Read notes from whichever field is currently rendered
  var notes = "";
  var nf = $("invSerialPromptNotes") || $("invSerialPromptBulkNotes");
  if (nf) notes = nf.value.trim();
  invCreateExceptionEvent(invSerialPromptScan, invSerialPromptType,
    "Unrecognized scan — entry cancelled",
    "Load a master history JSON with this device, or commit manually next time.",
    notes);
  invSetScanFeedback("Cancelled — exception logged for " + invSerialPromptScan + ".", "warn");
  $("invScanInput").value = "";
  invHideSerialPrompt();
}

// ===================================================================
// PHASE 6 — FLAG EVENTS FOR RECOUNT
// ===================================================================

function invToggleFlag(eventId) {
  var evt = invEvents.find(function(e) { return e.eventId === eventId; });
  if (!evt) return;
  evt.flagged = !evt.flagged;
  invSaveSession();
  renderInvEventLog();
}

// ===================================================================
// PHASE 7 — RECOUNT WORKFLOW
// ===================================================================

var invRecountItems      = [];  // [{ itemNumber, description, prevQty, prevLocations, done, recountQty, receivedSince, fulfilledSince, notes }]
var invRecountCurrentIdx = -1;
var invRecountParentId   = "";

function invStartRecount() {
  if (!invSession || invSession.status !== "closed") {
    alert("Finalize the current inventory session before starting a recount.");
    return;
  }
  if (invRecountItems.length && !confirm("A recount list already exists. Start fresh?")) return;

  invRecountParentId = invSession.sessionId;
  invRecountItems    = [];
  invRecountCurrentIdx = -1;

  // Create a new linked session
  var username   = timGetUsername() || "user";
  var now        = invNow();
  var d          = new Date();
  var stamp      = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0") + "_" + String(d.getHours()).padStart(2,"0") + String(d.getMinutes()).padStart(2,"0");
  invSession = {
    sessionId:       "RC-" + Date.now(),
    sessionName:     username + "_RECOUNT_" + stamp,
    sessionType:     "recount",
    parentSessionId: invRecountParentId,
    createdAt:       now,
    updatedAt:       now,
    status:          "active",
    sequenceCounter: 0
  };
  invEvents = [];
  invReelIdConflicts = [];
  renderReelIdConflictBanner();

  var infoEl = $("invRecountParentInfo");
  if (infoEl) infoEl.textContent = "Linked to: " + invRecountParentId;

  var card = $("invRecountCard");
  if (card) card.classList.remove("hidden");

  renderInvSidebarSession();
  renderInvStatusBar();
  renderInvEventLog();
  renderRecountQueue();
  switchTab("inventory");
  setTimeout(function() { var el = $("invRecountCard"); if (el) el.scrollIntoView({ behavior:"smooth" }); }, 200);
}

function invBuildRecountFromParent() {
  var parentEvents = (appData.inventory_events || []).filter(function(e) {
    return e.sessionId === invRecountParentId && e.status !== "voided" &&
           (e.eventType === "bulk_quantity_count" || e.eventType === "cable_reel_count" || e.eventType === "serialized_device_scan");
  });

  var seen = {};
  parentEvents.forEach(function(e) {
    var key = (e.itemNumber || e.scannedValue || "").toUpperCase();
    if (!key) return;
    if (!seen[key]) {
      var locs = parentEvents.filter(function(x) { return (x.itemNumber || x.scannedValue || "").toUpperCase() === key; })
                             .map(function(x) { return x.location || ""; }).filter(function(v,i,a) { return v && a.indexOf(v)===i; });
      var prevQty = parentEvents.filter(function(x) { return (x.itemNumber || x.scannedValue || "").toUpperCase() === key; })
                                .reduce(function(s,x) { return s + (x.qty || 0); }, 0);
      seen[key] = true;
      // Avoid duplicates in list
      if (!invRecountItems.some(function(r) { return r.itemNumber === key; })) {
        invRecountItems.push({ itemNumber: key, description: e.description || "", prevQty: prevQty, prevLocations: locs, done: false, recountQty: null, receivedSince: null, fulfilledSince: null, notes: "" });
      }
    }
  });
  renderRecountQueue();
}

function invAddToRecountList() {
  var inp = $("invRecountAddInput");
  if (!inp) return;
  var val = sanitizeScannerValue(inp.value, { uppercase: true });
  if (!val) return;
  inp.value = "";
  inp.focus();

  if (invRecountItems.some(function(r) { return r.itemNumber === val; })) {
    invSetScanFeedback(val + " is already in the recount list.", "warn");
    return;
  }

  // Look up description from product map or parent events
  var mm = findProductMapMatch(val);
  var description = mm ? getMapDescription(mm.entry) : "";
  var parentEvents = (appData.inventory_events || []).filter(function(e) {
    return e.sessionId === invRecountParentId && e.status !== "voided" &&
           (e.itemNumber || e.scannedValue || "").toUpperCase() === val;
  });
  if (!description && parentEvents.length) description = parentEvents[0].description || "";
  var prevQty  = parentEvents.reduce(function(s,e) { return s + (e.qty || 0); }, 0);
  var prevLocs = parentEvents.map(function(e) { return e.location || ""; }).filter(function(v,i,a) { return v && a.indexOf(v)===i; });

  invRecountItems.push({ itemNumber: val, description: description, prevQty: prevQty, prevLocations: prevLocs, done: false, recountQty: null, receivedSince: null, fulfilledSince: null, notes: "" });
  renderRecountQueue();
}

function renderRecountQueue() {
  var listEl     = $("invRecountQueueEl");
  var emptyEl    = $("invRecountListEmpty");
  var container  = $("invRecountListContainer");
  var statsEl    = $("invRecountListStats");

  if (!listEl) return;

  if (!invRecountItems.length) {
    if (emptyEl)   emptyEl.style.display    = "";
    if (container) container.classList.add("hidden");
    return;
  }

  if (emptyEl)   emptyEl.style.display    = "none";
  if (container) container.classList.remove("hidden");

  var done  = invRecountItems.filter(function(r) { return r.done; }).length;
  var total = invRecountItems.length;
  if (statsEl) statsEl.textContent = done + " of " + total + " recounted";

  listEl.innerHTML = invRecountItems.map(function(r, i) {
    var active = (i === invRecountCurrentIdx);
    var cls    = "inv-recount-queue-row" + (r.done ? " rq-done" : "") + (active ? " rq-active" : "");
    var check  = r.done ? "&#10003;" : (active ? "&#9658;" : "");
    var prev   = r.prevQty ? "prev: " + r.prevQty : "";
    return '<div class="' + cls + '">' +
      '<span class="rq-check">' + check + '</span>' +
      '<span class="rq-item">' + escapeHtml(r.itemNumber) + (r.description ? ' <span style="font-weight:400;color:#64748b;">' + escapeHtml(r.description) + '</span>' : '') + '</span>' +
      '<span class="rq-prev">' + escapeHtml(prev) + '</span>' +
      '<button class="secondary" style="padding:2px 8px;font-size:11px;" onclick="invRecountItems.splice(' + i + ',1);renderRecountQueue();">&#10005;</button>' +
      '</div>';
  }).join("");
}

function invRecountBeginWalkthrough() {
  invRecountCurrentIdx = invRecountItems.findIndex(function(r) { return !r.done; });
  if (invRecountCurrentIdx < 0) { alert("All items are already recounted."); return; }
  var wt = $("invRecountWalkthrough");
  if (wt) wt.classList.remove("hidden");
  invRecountShowCurrent();
}

function invRecountEndWalkthrough() {
  var wt = $("invRecountWalkthrough");
  if (wt) wt.classList.add("hidden");
  invRecountCurrentIdx = -1;
  renderRecountQueue();
}

function invRecountShowCurrent() {
  var r = invRecountItems[invRecountCurrentIdx];
  if (!r) { invRecountEndWalkthrough(); return; }

  var itemEl    = $("invRecountCurrentItem");
  var metaEl    = $("invRecountCurrentMeta");
  var progressEl= $("invRecountProgress");
  var qtyEl     = $("invRecountQtyInput");
  var recEl     = $("invRecountReceivedInput");
  var fulEl     = $("invRecountFulfilledInput");
  var noteEl    = $("invRecountNoteInput");

  if (itemEl)    itemEl.textContent    = r.itemNumber + (r.description ? " — " + r.description : "");
  if (qtyEl)     qtyEl.value           = "";
  if (recEl)     recEl.value           = "";
  if (fulEl)     fulEl.value           = "";
  if (noteEl)    noteEl.value          = "";

  var done  = invRecountItems.filter(function(x) { return x.done; }).length;
  var total = invRecountItems.length;
  if (progressEl) progressEl.textContent = (invRecountCurrentIdx + 1) + " / " + total + " (" + done + " done)";

  var metaParts = [];
  if (r.prevQty)       metaParts.push("Previous count: " + r.prevQty);
  if (r.prevLocations && r.prevLocations.length) metaParts.push("Locations: " + r.prevLocations.join(", "));
  if (metaEl) metaEl.textContent = metaParts.join("  ·  ");

  renderRecountQueue();
  setTimeout(function() { if (qtyEl) qtyEl.focus(); }, 50);
}

function invRecountSaveItem() {
  var r   = invRecountItems[invRecountCurrentIdx];
  if (!r) return;
  var qty = parseInt($("invRecountQtyInput") ? $("invRecountQtyInput").value : "0", 10);
  if (isNaN(qty) || qty < 0) { alert("Enter a valid recount quantity (0 or more)."); return; }

  r.recountQty    = qty;
  r.receivedSince = parseInt($("invRecountReceivedInput")  ? $("invRecountReceivedInput").value  : "0", 10) || 0;
  r.fulfilledSince= parseInt($("invRecountFulfilledInput") ? $("invRecountFulfilledInput").value : "0", 10) || 0;
  r.notes         = ($("invRecountNoteInput") ? $("invRecountNoteInput").value : "").trim();
  r.done          = true;

  invCreateEvent("recount_count", {
    scanType:        "item_number",
    scannedValue:    r.itemNumber,
    itemNumber:      r.itemNumber,
    description:     r.description,
    location:        invCurrentLocation || "",
    qty:             qty,
    prevQty:         r.prevQty,
    receivedSince:   r.receivedSince,
    fulfilledSince:  r.fulfilledSince,
    notes:           r.notes,
    parentSessionId: invRecountParentId
  });

  // Advance to next undone item
  var next = invRecountItems.findIndex(function(x, i) { return i > invRecountCurrentIdx && !x.done; });
  if (next < 0) next = invRecountItems.findIndex(function(x) { return !x.done; });
  if (next >= 0) {
    invRecountCurrentIdx = next;
    invRecountShowCurrent();
  } else {
    invRecountEndWalkthrough();
    invSetScanFeedback("All recount items complete!", "ok");
  }
}

function invRecountSkipItem() {
  var next = invRecountItems.findIndex(function(x, i) { return i > invRecountCurrentIdx && !x.done; });
  if (next < 0) next = invRecountItems.findIndex(function(x, i) { return i !== invRecountCurrentIdx && !x.done; });
  if (next >= 0) { invRecountCurrentIdx = next; invRecountShowCurrent(); }
  else { invRecountEndWalkthrough(); }
}

function exportRecountXlsx() {
  if (!invRecountItems.length && !invEvents.filter(function(e) { return e.eventType === "recount_count"; }).length) {
    alert("No recount data to export."); return;
  }
  var headers = ["Item Number","Description","Previous Qty","Recount Qty","Received Since","Fulfilled Since",
                 "Variance","Previous Locations","Location (recounted at)","Status","Notes","Timestamp"];
  var rows = invEvents.filter(function(e) { return e.eventType === "recount_count"; }).map(function(e) {
    var r = invRecountItems.find(function(x) { return x.itemNumber === e.itemNumber; }) || {};
    var variance = (e.qty != null && r.prevQty != null) ? (e.qty - r.prevQty) : "";
    return [
      e.itemNumber    || "",
      e.description   || "",
      r.prevQty       != null ? r.prevQty : "",
      e.qty           != null ? e.qty     : "",
      e.receivedSince != null ? e.receivedSince  : "",
      e.fulfilledSince!= null ? e.fulfilledSince : "",
      variance,
      (r.prevLocations || []).join(", "),
      e.location      || "",
      e.status        || "",
      e.notes         || "",
      e.timestamp     || ""
    ];
  });
  var ws   = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  ws["!cols"] = headers.map(function(h, i) {
    return { wch: Math.max(h.length, rows.reduce(function(m,r) { return Math.max(m, String(r[i]||"").length); }, 0)) + 2 };
  });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Recount");
  XLSX.writeFile(wb, "recount-" + new Date().toISOString().slice(0,10) + ".xlsx");
}

// ===================================================================
// PHASE 8 — XLSX EXPORTS (replaces CSV)
// ===================================================================

function invMakeXlsx(headers, rows, sheetName) {
  var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
  ws["!cols"] = headers.map(function(h, i) {
    return { wch: Math.max(h.length, rows.reduce(function(m, r) { return Math.max(m, String(r[i]||"").length); }, 0)) + 2 };
  });
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
  return wb;
}

// ═══════════════════════════════════════════════════════════════════════
// SPLIT EXPORT BUTTON — format picker (XLSX / CSV)
// ═══════════════════════════════════════════════════════════════════════

function invGetExportFmt(key) {
  try { return localStorage.getItem("tim_efmt_" + key) || "xlsx"; } catch(e) { return "xlsx"; }
}

function invPickExportFmt(key, fmt) {
  try { localStorage.setItem("tim_efmt_" + key, fmt); } catch(e) {}
  var menu = $("invExport" + (key === "adj" ? "Adj" : key === "summary" ? "Summary" : "EventLog") + "Menu");
  if (menu) menu.classList.add("hidden");
  invDoExport(key, fmt);
}

function invToggleExportMenu(key, e) {
  if (e) e.stopPropagation();
  var menuId = "invExport" + (key === "adj" ? "Adj" : key === "summary" ? "Summary" : "EventLog") + "Menu";
  var menu = $(menuId);
  if (menu) menu.classList.toggle("hidden");
}

function invDoExport(key, fmt) {
  fmt = fmt || invGetExportFmt(key);
  if (key === "summary")  { fmt === "csv" ? exportInvSummaryCsv()            : exportInvSummaryXlsx(); }
  else if (key === "adj") { fmt === "csv" ? exportInvOdooAdjustmentCsv()     : exportInvOdooAdjustmentXlsx(); }
  else                    { fmt === "csv" ? exportInvEventLogCsv()            : exportInvEventLogXlsx(); }
}

function exportInvEventLogXlsx() {
  if (!requireInvSession()) return;
  var headers = ["Seq","Timestamp","Event Type","Scan Type","Scanned Value",
                 "Item","Description","Serial","FSAN","Box ID","Location","Qty","Status","Flagged","Notes"];
  var rows = invEvents.map(function(e) {
    return buildEventLogBaseRow(e).concat([e.flagged ? "Yes" : "", e.notes || ""]);
  });
  var wb = invMakeXlsx(headers, rows, "Event Log");
  XLSX.writeFile(wb, "inv-event-log-" + new Date().toISOString().slice(0,10) + ".xlsx");
}

function exportInvSummaryXlsx() {
  if (!requireInvSession()) return;
  var map = buildInvSummaryMap(invEvents);
  var headers = ["Item","Description","Counted Qty","Serialized Count","Reel Footage (ft)","Exceptions","Flagged Events","Last Counted"];
  var rows = Object.keys(map).sort().map(function(k) {
    var r = map[k];
    return [r.item, r.description, r.countedQty, r.serializedCount, r.reelFootage || "", r.exceptions, r.flagged || "", r.lastCounted];
  });
  var wb = invMakeXlsx(headers, rows, "Summary");
  XLSX.writeFile(wb, "inv-summary-" + new Date().toISOString().slice(0,10) + ".xlsx");
}

// ===================================================================
// ODOO INVENTORY ADJUSTMENT EXPORT
// Columns match Odoo stock.quant CSV import format.
// Serial-tracked items → one row per serial (lot_id/name = serial).
// Bulk/box items       → one row per item+location (no lot, total qty).
// Reel items           → one row per reel (lot_id/name = reel number, qty = 1).
// ===================================================================

function buildOdooAdjustmentRows(events) {
  var headers = ["product_id/default_code", "location_id/complete_name", "lot_id/name", "inventory_quantity"];
  var rows = [];

  function pmFields(itemNumber) {
    var pm = findProductMapMatch(itemNumber || "");
    return {
      defCode: (pm && pm.entry && pm.entry.default_code) ? pm.entry.default_code : (itemNumber || "")
    };
  }

  function resolveLocation(barcode) {
    return invLocationBarcodeToCompleteName(barcode || "");
  }

  // Serialized device scans — one row per active event
  events.forEach(function(evt) {
    if (evt.status === "voided" || evt.eventType === "void_event") return;
    if (evt.eventType !== "serialized_device_scan") return;
    var f = pmFields(evt.itemNumber);
    var lotName = evt.serial || evt.fsan || evt.scannedValue || "";
    rows.push([f.defCode, resolveLocation(evt.location), lotName, 1]);
  });

  // Bulk quantity counts and box scans — aggregate by item + location
  var bulkMap = {};
  events.forEach(function(evt) {
    if (evt.status === "voided" || evt.eventType === "void_event") return;
    if (evt.eventType !== "bulk_quantity_count" && evt.eventType !== "box_scan") return;
    var key = (evt.itemNumber || "") + "\x00" + (evt.location || "");
    if (!bulkMap[key]) {
      var f2 = pmFields(evt.itemNumber);
      bulkMap[key] = { extId: f2.extId, defCode: f2.defCode, loc: evt.location || "", qty: 0 };
    }
    bulkMap[key].qty += (evt.eventType === "box_scan")
      ? (evt.resolvedDeviceCount || evt.qty || 1)
      : (evt.qty || 1);
  });
  Object.keys(bulkMap).sort().forEach(function(k) {
    var r = bulkMap[k];
    rows.push([r.defCode, resolveLocation(r.loc), "", r.qty]);
  });

  // Cable reel counts — one row per reel (lot-tracked, footage as qty)
  events.forEach(function(evt) {
    if (evt.status === "voided" || evt.eventType === "void_event") return;
    if (evt.eventType !== "cable_reel_count") return;
    var f3 = pmFields(evt.itemNumber);
    var lotName3 = evt.reelNumber || evt.scannedValue || "";
    rows.push([f3.defCode, resolveLocation(evt.location), lotName3, evt.totalAvailableFt != null ? evt.totalAvailableFt : 0]);
  });

  return { headers: headers, rows: rows };
}

function invWarnBlankLocations(rows) {
  var blank = rows.filter(function(r) { return !r[1]; }).length;
  if (blank) {
    alert(blank + " row" + (blank !== 1 ? "s" : "") + " ha" + (blank !== 1 ? "ve" : "s") + " no location.\n\nOdoo will reject these. Check that all items were scanned after setting a location, then re-export.");
  }
}

function exportInvOdooAdjustmentXlsx() {
  if (!requireInvSession()) return;
  var result = buildOdooAdjustmentRows(invEvents);
  if (!result.rows.length) { alert("No countable events to export."); return; }
  invWarnBlankLocations(result.rows);
  var wb = invMakeXlsx(result.headers, result.rows, "Inventory Adjustment");
  XLSX.writeFile(wb, "odoo-inv-adj-" + new Date().toISOString().slice(0, 10) + ".xlsx");
  invShowOdooImportReminder(result.rows.length);
}

function exportInvOdooAdjustmentCsv() {
  if (!requireInvSession()) return;
  var result = buildOdooAdjustmentRows(invEvents);
  if (!result.rows.length) { alert("No countable events to export."); return; }
  invWarnBlankLocations(result.rows);
  var lines = [result.headers.map(csvEscape).join(",")].concat(
    result.rows.map(function(r) { return r.map(csvEscape).join(","); })
  );
  downloadText("odoo-inv-adj-" + new Date().toISOString().slice(0, 10) + ".csv", lines.join("\r\n"), "text/csv");
  invShowOdooImportReminder(result.rows.length);
}

function invShowOdooImportReminder(rowCount) {
  var existing = $("invOdooImportReminderModal");
  if (existing) existing.remove();
  var modal = document.createElement("div");
  modal.id = "invOdooImportReminderModal";
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;";
  modal.innerHTML =
    '<div style="background:#fff;border-radius:12px;padding:28px 32px;max-width:460px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.22);">' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">' +
        '<span style="font-size:28px;">📋</span>' +
        '<h3 style="margin:0;font-size:17px;font-weight:700;color:#1e293b;">Odoo Import Checklist</h3>' +
      '</div>' +
      '<p style="margin:0 0 6px;font-size:13px;color:#475569;"><strong>' + rowCount + ' row' + (rowCount !== 1 ? 's' : '') + '</strong> exported. Follow these steps in Odoo:</p>' +
      '<ol style="margin:10px 0 18px;padding-left:20px;font-size:13px;color:#1e293b;line-height:2;">' +
        '<li>Inventory → Operations → <strong>Inventory Adjustments</strong></li>' +
        '<li>Click <strong>Import</strong> and upload this file</li>' +
        '<li>Verify the rows look correct</li>' +
        '<li style="color:#dc2626;font-weight:700;">Click <strong>Apply All</strong> — do NOT navigate away first</li>' +
        '<li>Confirm the adjustment dialog</li>' +
      '</ol>' +
      '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:12px;color:#991b1b;">' +
        '⚠️ <strong>Do not import twice.</strong> Navigating away before clicking Apply All and re-importing will double your counted quantities.' +
      '</div>' +
      '<button onclick="document.getElementById(\'invOdooImportReminderModal\').remove();" ' +
        'style="width:100%;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Got it</button>' +
    '</div>';
  document.body.appendChild(modal);
  modal.addEventListener("click", function(e) { if (e.target === modal) modal.remove(); });
}

// ===================================================================
// ODOO QUANT MAP — import Odoo Inventory Adjustments CSV to get quant IDs
// Workflow: Odoo → export Inv. Adj. CSV → load here → count in TIM
//           → export adj. CSV with quant IDs → Odoo updates in place
// ===================================================================

function invGetQuantId(defCode, locValue, lotName) {
  var key = normKey(defCode) + "||" + normKey(locValue) + "||" + normKey(lotName);
  var entry = invOdooQuantMap[key];
  return entry ? (entry.id || "") : "";
}

function invRenderOdooSetupSidebarStatus() {
  var uniqueIds = {};
  Object.values(invOdooQuantMap).forEach(function(e) { if (e.id) uniqueIds[e.id] = 1; });
  var quantMapCount  = Object.keys(uniqueIds).length;
  var baselineCount  = invQuantsBaseline.length;
  var locationCount  = Object.keys(invLocationMap).length;
  var displayCount   = baselineCount || quantMapCount || locationCount || null;
  updateSidebarStatus(2, displayCount);
  var label = $("sideOdooSetupLabel");
  if (label) {
    var parts = [];
    if (baselineCount)  parts.push("Quants ✓");
    if (locationCount)  parts.push("Locations ✓");
    if (quantMapCount)  parts.push("Adj. IDs ✓");
    label.textContent = parts.length ? parts.join(" · ") : "Quants Baseline · Location Map · Inv. Adj. Sync";
  }
}

function invRenderQuantMapStatus() {
  var clearBtn = $("invClearQuantMapBtn");
  var uniqueIds = {};
  Object.values(invOdooQuantMap).forEach(function(e) { if (e.id) uniqueIds[e.id] = 1; });
  var unique = Object.keys(uniqueIds).length;
  if (!unique) {
    setDropState("invQuantSyncZone", "invQuantSyncStatus", false, "Not loaded");
    if (clearBtn) clearBtn.style.display = "none";
  } else {
    var msg = unique + " quant record" + (unique !== 1 ? "s" : "") + " loaded — IDs matched on export.";
    setDropState("invQuantSyncZone", "invQuantSyncStatus", true, msg);
    if (clearBtn) clearBtn.style.display = "";
  }
  invRenderOdooSetupSidebarStatus();
}

function invSaveOdooQuantMap() {
  TimDB.set(INV_QUANT_MAP_KEY, invOdooQuantMap).catch(function(){});
}

function invLoadOdooQuantMap() {
  return TimDB.get(INV_QUANT_MAP_KEY).then(function(saved) {
    if (saved && typeof saved === "object" && Object.keys(saved).length) {
      invOdooQuantMap = saved;
      invRenderQuantMapStatus();
    }
  }).catch(function(){});
}

function invClearOdooQuantMap() {
  invOdooQuantMap = {};
  TimDB.remove(INV_QUANT_MAP_KEY).catch(function(){});
  invRenderQuantMapStatus();
}

function invImportOdooQuantsCsv(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try { invProcessOdooQuantCsv(e.target.result, file.name); }
    catch(err) { alert("Quant import failed: " + err.message); }
  };
  reader.readAsText(file);
}

function invProcessOdooQuantCsv(text, fileName) {
  var lines = text.split(/\r?\n/);
  if (!lines.length) throw new Error("Empty file.");
  var header = bcParseCsvRow(lines[0] || "");

  function colIdx() {
    var names = Array.prototype.slice.call(arguments);
    for (var i = 0; i < names.length; i++) {
      var n = names[i].toLowerCase();
      var idx = header.findIndex(function(h) { return h.trim().toLowerCase() === n; });
      if (idx !== -1) return idx;
    }
    return -1;
  }

  var idIdx      = colIdx("id");
  var codeIdx    = colIdx("product_id/default_code", "default_code");
  var barcodeIdx = colIdx("location_id/barcode");
  var cnIdx      = colIdx("location_id/complete_name", "location_id/name");
  var lotIdx     = colIdx("lot_id/name");
  var qtyIdx     = colIdx("quantity", "on_hand_quantity");

  if (idIdx === -1)
    throw new Error("Column 'id' not found. In Odoo, export Inventory Adjustments and make sure the ID column is included.");
  if (codeIdx === -1)
    throw new Error("Column 'product_id/default_code' not found.");
  if (barcodeIdx === -1 && cnIdx === -1)
    throw new Error("No location column found. Include 'location_id/barcode' or 'location_id/complete_name' in the Odoo export.");

  var newMap = {};
  var loaded = 0;

  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var cells  = bcParseCsvRow(line);
    var quantId  = (idIdx      >= 0 ? cells[idIdx]      : "").trim();
    var defCode  = (codeIdx    >= 0 ? cells[codeIdx]    : "").trim();
    var barcode  = (barcodeIdx >= 0 ? cells[barcodeIdx] : "").trim();
    var cn       = (cnIdx      >= 0 ? cells[cnIdx]      : "").trim();
    var lotName  = (lotIdx     >= 0 ? cells[lotIdx]     : "").trim();
    var onHand   = qtyIdx      >= 0 ? (parseFloat(cells[qtyIdx]) || 0) : 0;

    if (!quantId || !defCode) continue;

    var entry = { id: quantId, onHandQty: onHand };
    // Store under barcode key AND complete_name key so lookup works either way
    if (barcode) newMap[normKey(defCode) + "||" + normKey(barcode) + "||" + normKey(lotName)] = entry;
    if (cn)      newMap[normKey(defCode) + "||" + normKey(cn)      + "||" + normKey(lotName)] = entry;
    loaded++;
  }

  if (!loaded)
    throw new Error("No valid rows found. Verify the file has 'id' and 'product_id/default_code' columns with data.");

  invOdooQuantMap = newMap;
  invSaveOdooQuantMap();
  invRenderQuantMapStatus();
  // Override status text with filename for context
  var statusEl = $("invQuantSyncStatus");
  if (statusEl) statusEl.textContent = loaded + " record" + (loaded !== 1 ? "s" : "") + " loaded from " + (fileName || "file") + ".";
}

// ═══════════════════════════════════════════════════════════════════════
// LOCATION MAP — Odoo location path → barcode lookup
// Load once from Odoo Inventory Locations CSV. Rarely needs refresh.
// Used by the Quants Baseline loader to resolve location paths to the
// barcodes that TIM events carry, so quant map keys match on export.
// ═══════════════════════════════════════════════════════════════════════

var invLocationMap = {};
var invLocationBarcodeMap = {};  // normKey(barcode) → complete_name path
const INV_LOCATION_MAP_KEY = "tim_location_map_v1";

function invLocationPathToBarcode(path) {
  if (!path) return "";
  var barcode = invLocationMap[normKey(path)];
  return barcode || path; // fall back to original value if not mapped
}

function invLocationBarcodeToCompleteName(barcode) {
  if (!barcode) return "";
  var path = invLocationBarcodeMap[normKey(barcode)];
  return path || barcode; // fall back to barcode if not mapped
}

function invRenderLocationMapStatus() {
  var clearBtn = $("invLocationMapClearBtn");
  var count = Object.keys(invLocationMap).length;
  if (!count) {
    setDropState("invLocationMapZone", "invLocationMapStatus", false, "Not loaded");
    if (clearBtn) clearBtn.style.display = "none";
  } else {
    var msg = count.toLocaleString() + " location" + (count !== 1 ? "s" : "") + " mapped";
    setDropState("invLocationMapZone", "invLocationMapStatus", true, msg);
    if (clearBtn) clearBtn.style.display = "";
  }
  invRenderOdooSetupSidebarStatus();
}

const INV_LOCATION_BARCODE_MAP_KEY = "tim_location_barcode_map_v1";

function invSaveLocationMap() {
  TimDB.set(INV_LOCATION_MAP_KEY, invLocationMap).catch(function(){});
  TimDB.set(INV_LOCATION_BARCODE_MAP_KEY, invLocationBarcodeMap).catch(function(){});
}

function invLoadLocationMap() {
  return Promise.all([
    TimDB.get(INV_LOCATION_MAP_KEY),
    TimDB.get(INV_LOCATION_BARCODE_MAP_KEY)
  ]).then(function(results) {
    var savedPath = results[0], savedBarcode = results[1];
    if (savedPath && typeof savedPath === "object" && Object.keys(savedPath).length) {
      invLocationMap = savedPath;
      if (savedBarcode && typeof savedBarcode === "object") invLocationBarcodeMap = savedBarcode;
      invRenderLocationMapStatus();
    }
  }).catch(function(){});
}

function invClearLocationMap() {
  invLocationMap = {};
  invLocationBarcodeMap = {};
  TimDB.remove(INV_LOCATION_MAP_KEY).catch(function(){});
  TimDB.remove(INV_LOCATION_BARCODE_MAP_KEY).catch(function(){});
  invRenderLocationMapStatus();
}

function invImportLocationMapCsv(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try { invProcessLocationMapCsv(e.target.result, file.name); }
    catch(err) { alert("Location map import failed: " + err.message); }
  };
  reader.readAsText(file);
}

function invProcessLocationMapCsv(text, fileName) {
  var lines = text.split(/\r?\n/);
  if (!lines.length) throw new Error("Empty file.");
  var header = bcParseCsvRow(lines[0] || "");

  function colIdx() {
    var names = Array.prototype.slice.call(arguments);
    for (var i = 0; i < names.length; i++) {
      var n = names[i].toLowerCase().trim();
      var idx = header.findIndex(function(h) { return h.trim().toLowerCase() === n; });
      if (idx !== -1) return idx;
    }
    return -1;
  }

  var parentIdx       = colIdx("location_id");   // parent path e.g. "W367/S"
  var nameIdx         = colIdx("name");           // location name e.g. "Y01"
  var barcodeIdx      = colIdx("barcode");        // barcode e.g. "WHY01"
  var completeNameIdx = colIdx("complete_name");  // Odoo full path if exported

  if (nameIdx    === -1) throw new Error("Column 'name' not found. Export Locations from Odoo: Inventory → Configuration → Locations.");
  if (barcodeIdx === -1) throw new Error("Column 'barcode' not found.");

  var newMap = {};
  var newBarcodeMap = {};
  var loaded = 0;

  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var cells        = bcParseCsvRow(line);
    var parent       = (parentIdx       >= 0 ? cells[parentIdx]       : "").trim();
    var name         = (nameIdx         >= 0 ? cells[nameIdx]         : "").trim();
    var barcode      = (barcodeIdx      >= 0 ? cells[barcodeIdx]      : "").trim();
    var completeName = (completeNameIdx >= 0 ? cells[completeNameIdx] : "").trim();

    if (!name || !barcode) continue;

    // Construct full path: "W367/S/Y01" or just "Rental" when no parent
    var fullPath = parent ? parent + "/" + name : name;
    newMap[normKey(fullPath)] = barcode;
    newBarcodeMap[normKey(barcode)] = completeName || fullPath;
    loaded++;
  }

  if (!loaded)
    throw new Error("No valid rows found. Verify this is an Odoo Locations export with 'name' and 'barcode' columns.");

  invLocationMap = newMap;
  invLocationBarcodeMap = newBarcodeMap;
  invSaveLocationMap();
  invRenderLocationMapStatus();
  var statusEl = $("invLocationMapStatus");
  if (statusEl) statusEl.textContent = loaded + " location" + (loaded !== 1 ? "s" : "") + " loaded from " + (fileName || "file") + ".";
}

// ═══════════════════════════════════════════════════════════════════════
// QUANTS BASELINE — Odoo on-hand expected quantities for gap analysis
// ═══════════════════════════════════════════════════════════════════════

var invQuantsBaseline = [];
var invQuantsBaselineImportedAt = null;
const INV_QUANTS_BASELINE_KEY = "tim_odoo_quants_baseline_v1";

function invRenderQuantsBaselineStatus() {
  var count = invQuantsBaseline.length;
  var clearBtn = $("invQuantsBaselineClearBtn");
  if (!count) {
    setDropState("invQuantsBaselineZone", "invQuantsBaselineStatus", false, "Not loaded");
    if (clearBtn) clearBtn.style.display = "none";
  } else {
    var msg = count.toLocaleString() + " quant record" + (count !== 1 ? "s" : "") + " loaded";
    if (invQuantsBaselineImportedAt) msg += " · " + new Date(invQuantsBaselineImportedAt).toLocaleDateString();
    setDropState("invQuantsBaselineZone", "invQuantsBaselineStatus", true, msg);
    if (clearBtn) clearBtn.style.display = "";
  }
  invRenderOdooSetupSidebarStatus();
}

function invSaveQuantsBaseline() {
  TimDB.set(INV_QUANTS_BASELINE_KEY, { quants: invQuantsBaseline, importedAt: invQuantsBaselineImportedAt }).catch(function(){});
  appData.odoo_quants = invQuantsBaseline;
}

function invLoadQuantsBaseline() {
  return TimDB.get(INV_QUANTS_BASELINE_KEY).then(function(saved) {
    if (saved && Array.isArray(saved.quants) && saved.quants.length) {
      invQuantsBaseline = saved.quants;
      invQuantsBaselineImportedAt = saved.importedAt || null;
      appData.odoo_quants = invQuantsBaseline;
      invRenderQuantsBaselineStatus();
    }
  }).catch(function(){});
}

function invClearQuantsBaseline() {
  invQuantsBaseline = [];
  invQuantsBaselineImportedAt = null;
  appData.odoo_quants = [];
  TimDB.remove(INV_QUANTS_BASELINE_KEY).catch(function(){});
  invRenderQuantsBaselineStatus();
}

function invImportQuantsBaseline(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try { invProcessQuantsBaselineCsv(e.target.result, file.name); }
    catch(err) { alert("Quants baseline import failed: " + err.message); }
  };
  reader.readAsText(file);
}

function invProcessQuantsBaselineCsv(text, fileName) {
  var lines = text.split(/\r?\n/);
  if (!lines.length) throw new Error("Empty file.");
  var header = bcParseCsvRow(lines[0] || "");

  function colIdx() {
    var names = Array.prototype.slice.call(arguments);
    for (var i = 0; i < names.length; i++) {
      var n = names[i].toLowerCase().trim();
      var idx = header.findIndex(function(h) { return h.trim().toLowerCase() === n; });
      if (idx !== -1) return idx;
    }
    return -1;
  }

  var idIdx         = colIdx("id");
  var prodIdx       = colIdx("product_id");
  var varExtIdIdx   = colIdx("product_id/id");
  var locIdx        = colIdx("location_id");
  var lotIdx        = colIdx("lot_id");
  var qtyIdx        = colIdx("quantity", "inventory_quantity_auto_apply");
  var invQtyIdx     = colIdx("inventory_quantity");
  var dateIdx       = colIdx("accounting_date");

  if (idIdx === -1)   throw new Error("Column 'id' not found. Export Quants from Odoo: Inventory → Products → Quants.");
  if (prodIdx === -1) throw new Error("Column 'product_id' not found.");
  if (locIdx === -1)  throw new Error("Column 'location_id' not found.");
  if (qtyIdx === -1)  throw new Error("Column 'quantity' or 'inventory_quantity_auto_apply' not found.");

  // Parse [itemNumber] description format from product_id
  function parseProductId(raw) {
    var m = raw.match(/^\[([^\]]+)\]\s*(.*)/);
    if (m) return { itemNumber: m[1].trim(), description: m[2].trim() };
    return { itemNumber: raw.trim(), description: "" };
  }

  var newRows           = [];
  var newQuantMap       = {};   // quant IDs to merge into invOdooQuantMap
  var variantExtIdMap   = {};   // itemNumber → product_id/id for PRODUCT_MAP update
  var importedAt        = new Date().toISOString();

  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var cells = bcParseCsvRow(line);

    var quantId        = (idIdx       >= 0 ? (cells[idIdx]       || "") : "").trim();
    var rawProd        = (prodIdx     >= 0 ? (cells[prodIdx]     || "") : "").trim();
    var variantExtId   = (varExtIdIdx >= 0 ? (cells[varExtIdIdx] || "") : "").trim();
    var locationPath   = (locIdx      >= 0 ? (cells[locIdx]      || "") : "").trim();
    var lotId          = (lotIdx      >= 0 ? (cells[lotIdx]      || "") : "").trim();
    var odooQty        = qtyIdx    >= 0 ? (parseFloat(cells[qtyIdx]    || 0) || 0) : 0;
    var inventoryQty   = invQtyIdx >= 0 ? (parseFloat(cells[invQtyIdx] || 0) || 0) : 0;
    var accountingDate = (dateIdx  >= 0 ? (cells[dateIdx]       || "") : "").trim();

    if (!quantId || !rawProd) continue;

    var prod    = parseProductId(rawProd);
    var barcode = invLocationPathToBarcode(locationPath);

    // Baseline row — store both path and resolved barcode for reference
    newRows.push({
      quantId:         quantId,
      itemNumber:      prod.itemNumber,
      description:     prod.description,
      locationId:      locationPath,
      locationBarcode: barcode,
      lotId:           lotId,
      odooQty:         odooQty,
      inventoryQty:    inventoryQty,
      accountingDate:  accountingDate,
      importedAt:      importedAt
    });

    // Quant map entry — keyed by defCode||barcode||lot (matches invGetQuantId lookup format)
    var qmKey = normKey(prod.itemNumber) + "||" + normKey(barcode) + "||" + normKey(lotId);
    newQuantMap[qmKey] = { id: quantId, onHandQty: odooQty };

    // Collect variant external IDs for PRODUCT_MAP update (skip product_template IDs)
    if (variantExtId && !/product_template/i.test(variantExtId)) {
      variantExtIdMap[prod.itemNumber] = variantExtId;
    }
  }

  if (!newRows.length)
    throw new Error("No valid rows found. Verify this is an Odoo Quants export with 'id', 'product_id', 'location_id', and 'quantity' columns.");

  // ── 1. Upsert baseline ──────────────────────────────────────────────
  var incomingKeys = {};
  newRows.forEach(function(r) {
    incomingKeys[r.itemNumber + "||" + r.locationId + "||" + r.lotId] = true;
  });
  var kept = invQuantsBaseline.filter(function(q) {
    return !incomingKeys[q.itemNumber + "||" + q.locationId + "||" + q.lotId];
  });
  invQuantsBaseline = kept.concat(newRows);
  invQuantsBaselineImportedAt = importedAt;
  invSaveQuantsBaseline();
  invRenderQuantsBaselineStatus();

  // ── 2. Merge quant IDs into invOdooQuantMap ─────────────────────────
  // Overwrites matching keys with fresh IDs; leaves unrelated entries intact.
  Object.assign(invOdooQuantMap, newQuantMap);
  invSaveOdooQuantMap();
  invRenderQuantMapStatus();

  // ── 3. Update PRODUCT_MAP with variant external IDs ─────────────────
  var pmUpdated = 0;
  Object.keys(variantExtIdMap).forEach(function(itemNumber) {
    var extId = variantExtIdMap[itemNumber];
    var match = findProductMapMatch(itemNumber);
    if (match && match.entry) {
      // Only overwrite if current value is missing or is a blocked product_template ID
      var current = getMapExternalId(match.entry);
      if (!current || /product_template/i.test(current)) {
        match.entry.odoo_external_id = extId;
        pmUpdated++;
      }
    } else {
      // No existing entry — create a minimal placeholder
      PRODUCT_MAP[itemNumber] = {
        hctc:             itemNumber,
        odoo_external_id: extId,
        name:             null,
        serial_tracked:   false
      };
      pmUpdated++;
    }
  });
  if (pmUpdated > 0) timSaveMasterCache();

  // ── Status message ───────────────────────────────────────────────────
  var quantCount = Object.keys(newQuantMap).length;
  var statusEl = $("invQuantsBaselineStatus");
  if (statusEl) {
    var parts = [newRows.length.toLocaleString() + " quant record" + (newRows.length !== 1 ? "s" : "") + " imported"];
    if (quantCount) parts.push(quantCount + " quant ID" + (quantCount !== 1 ? "s" : "") + " indexed");
    if (pmUpdated)  parts.push(pmUpdated  + " product variant ID" + (pmUpdated !== 1 ? "s" : "") + " updated");
    parts.push("from " + (fileName || "file"));
    statusEl.textContent = parts.join(" · ") + ". Total baseline: " + invQuantsBaseline.length.toLocaleString() + " records.";
  }
}

// -- Scan input keyboard handler -----------------------------------
// Script runs at end of body so DOM is already available here.
(function() {
  var input = $("invScanInput");
  if (input) {
    input.addEventListener("input", function() {
      invUpdateDetectedBadge(input.value);
    });
    input.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        invProcessScan();
      } else if (e.key === "Tab" && invLastBulkEventId && invQtyKeypadMode === "qty") {
        e.preventDefault();
        invEnterQtyMode();
      }
    });
  }
  // When notes/item fields lose focus, return to scan input so keyboard dismisses
  // and the next scan goes to the right place. Skips if a modal or inline panel is open.
  function invMaybeRefocusScanInput() {
    setTimeout(function() {
      if (document.querySelector('.modal-backdrop:not(.hidden)')) return;
      var spp = $("invSerialPromptPanel");
      if (spp && !spp.classList.contains("hidden")) return;
      // Only block refocus if focus is actively inside the reel entry panel
      var active = document.activeElement;
      var rip = $("invReelInlinePanel");
      if (rip && !rip.classList.contains("hidden") && active && rip.contains(active)) return;
      var si = $("invScanInput");
      if (si) si.focus();
    }, 150);
  }

  var notesInput = $("invScanNotes");
  if (notesInput) {
    notesInput.addEventListener("blur", invMaybeRefocusScanInput);
  }

  var itemInput = $("invScanItem");
  if (itemInput) {
    itemInput.addEventListener("input", function() {
      itemInput.value = sanitizeScannerValue(itemInput.value, { uppercase: true });
    });
    itemInput.addEventListener("blur", invMaybeRefocusScanInput);
  }

  var locationInput = $("invScanLocation");
  if (locationInput) {
    locationInput.addEventListener("keydown", function(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var val = sanitizeScannerValue(locationInput.value, { uppercase: true });
        invSetLocation(val);
        invSetScanFeedback(val ? "Location set to: " + val : "Location cleared.", val ? "ok" : "info");
        setTimeout(function() { var i = $("invScanInput"); if (i) i.focus(); }, 50);
      }
    });
  }

  // Notes modal: Escape to close, Ctrl+Enter to save
  document.addEventListener("keydown", function(e) {
    var modal = $("invNotesModal");
    if (!modal || modal.classList.contains("hidden")) return;
    if (e.key === "Escape") { e.preventDefault(); invCloseNotesModal(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); invSaveNotesModal(); }
  });

  // Reel modal: Escape discards (creates exception), Ctrl+Enter saves from anywhere
  document.addEventListener("keydown", function(e) {
    var rip = $("invReelInlinePanel");
    if (!rip || rip.classList.contains("hidden")) return;
    if (e.key === "Escape") { e.preventDefault(); invDiscardReelEntry(); }
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); invSubmitReelEntry(); }
  });

  // Reel inline: track which sequence field has focus so the soft keypad can target it
  (function() {
    var rip = $("invReelInlinePanel");
    if (!rip) return;
    rip.addEventListener("focusin", function(e) {
      var t = e.target;
      if (t && (t.type === "number") && !t.readOnly) {
        invKeypadTargetEl = t;
        if (invQtyKeypadMode === "reel") invQtyKeypadRefreshReelTarget();
      }
    });
  })();

  // Item history modal: Escape to close
  document.addEventListener("keydown", function(e) {
    var modal = $("prodHistoryModal");
    if (!modal || modal.classList.contains("hidden")) return;
    if (e.key === "Escape") { e.preventDefault(); prodCloseHistoryModal(); }
  });

  // Qty keypad: physical keyboard support (item mode only; reel fields and scan input handle their own)
  document.addEventListener("keydown", function(e) {
    if (invQtyKeypadMode !== "qty") return; // reel fields handle their own keyboard
    // Never intercept when the scan input or any text input has focus
    var si = $("invScanInput");
    var active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT")) return;
    if (e.key >= "0" && e.key <= "9") { e.preventDefault(); invQtyKeyDigit(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); invQtyKeyBackspace(); }
    else if (e.key === "-" || e.key === "+") { e.preventDefault(); invQtyKeySign(); }
    else if (e.key === "Enter") { e.preventDefault(); invQtyKeyApply(); }
    else if (e.key === "Escape") { e.preventDefault(); invQtyKeySkip(); }
  });

  // Render mode-switch barcodes (JsBarcode — graceful if CDN unavailable)
  (function() {
    var codes = [
      { id: "invBarcodeSerial", value: "##MSERIAL" },
      { id: "invBarcodeReel",   value: "##MREEL"   },
      { id: "invBarcodeItem",   value: "##MITEM"   },
      { id: "invBarcodeAuto",   value: "##MAUTO"   }
    ];
    if (typeof JsBarcode === "undefined") return;
    codes.forEach(function(c) {
      var el = $(c.id);
      if (!el) return;
      try {
        JsBarcode(el, c.value, {
          format: "CODE128", width: 2, height: 48,
          displayValue: false, margin: 4, background: "#ffffff", lineColor: "#1f2937"
        });
      } catch(e) { /* ignore render errors */ }
    });
  })();

  // Product upload zone drag-and-drop
  (function() {
    var zone = $("prodUploadZone");
    if (!zone) return;
    zone.addEventListener("dragover", function(e) { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", function() { zone.classList.remove("dragover"); });
    zone.addEventListener("drop", function(e) {
      e.preventDefault(); zone.classList.remove("dragover");
      var file = e.dataTransfer.files[0];
      if (file) prodBulkUpload(file);
    });
  })();
})();

// ═══════════════════════════════════════════════════════════════════════
// MASTER DATA CACHE  —  persists product_map + history across reloads
// ═══════════════════════════════════════════════════════════════════════

const TIM_MASTER_CACHE_KEY = "tim_master_cache_v1";

function timSaveMasterCache() {
  TimDB.set(TIM_MASTER_CACHE_KEY, { product_map: PRODUCT_MAP, history: history }).catch(function(){});
}

function timLoadMasterCache() {
  return TimDB.get(TIM_MASTER_CACHE_KEY).then(function(parsed) {
    if (!parsed) return false;
    var hadData = false;
    if (parsed.product_map && typeof parsed.product_map === "object" && Object.keys(parsed.product_map).length) {
      PRODUCT_MAP = parsed.product_map;
      appData.product_map = PRODUCT_MAP;
      $("mapPreview").value = JSON.stringify(PRODUCT_MAP, null, 2);
      hadData = true;
    }
    if (parsed.history && Array.isArray(parsed.history.records)) {
      history = parsed.history;
      appData.history = history;
      hadData = true;
    }
    if (hadData) {
      var pCount = Object.keys(PRODUCT_MAP).length;
      var hCount = (history.records || []).length;
      setDropState("historyDropZone", "historyDropStatus", true, "Restored from local cache");
      $("historyStatus").textContent = pCount + " products, " + hCount + " history records (restored from local cache — load master JSON to refresh).";
      updateSidebarStatus(1, hCount);
      prodRenderList();
      checkReelItemConflicts();
    }
    return hadData;
  }).catch(function() { return false; });
}

// ═══════════════════════════════════════════════════════════════════════
// SHARED EXPORT HELPER (10-year purge on inventory_events)
// ═══════════════════════════════════════════════════════════════════════

function buildExportPayload() {
  var PURGE_YEARS = 10;
  var cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - PURGE_YEARS);
  var cutoffISO = cutoff.toISOString();
  return {
    product_map: PRODUCT_MAP,
    history: history,
    inventory_sessions: appData.inventory_sessions || [],
    inventory_events: (appData.inventory_events || []).filter(function(e) {
      return !e.timestamp || e.timestamp >= cutoffISO;
    }),
    barcode_map: BARCODE_MAP,
    odoo_quants: appData.odoo_quants || [],
    recount_sessions:  appData.recount_sessions  || [],
    recount_movements: appData.recount_movements || []
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PRODUCTS TAB
// ═══════════════════════════════════════════════════════════════════════

function getTrackingType(map) {
  if (!map) return "none";
  if (map.tracking_type) return map.tracking_type;
  if (map.serial_tracked) return "serial";
  return "none";
}

function prodToggleNotes() {
  var body = $("prodNotesBody");
  if (body) body.classList.toggle("hidden");
}

function prodRenderList() {
  var tbody = $("prodCatalogBody");
  var countEl = $("prodCatalogCount");
  if (!tbody) return;

  var searchQ = normKey(($("prodSearch") ? $("prodSearch").value : "") || "");
  var filterTracking = $("prodFilterTracking") ? $("prodFilterTracking").value : "";
  var allKeys = Object.keys(PRODUCT_MAP);

  var filtered = allKeys.filter(function(key) {
    var map = PRODUCT_MAP[key] || {};
    var trackingType = getTrackingType(map);
    if (filterTracking && trackingType !== filterTracking) return false;
    if (searchQ) {
      var haystack = normKey([key, map.hctc || "", map.name || map.description || "", map.vendor || "", trackingType].join(" "));
      if (haystack.indexOf(searchQ) === -1) return false;
    }
    return true;
  });

  if (countEl) countEl.textContent = allKeys.length + " product" + (allKeys.length !== 1 ? "s" : "") +
    (filtered.length !== allKeys.length ? " (" + filtered.length + " shown)" : "");

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:24px;">' +
      (allKeys.length ? "No products match the current filters." : "Load a master JSON or upload products to populate the catalog.") +
      "</td></tr>";
    updateClearBtns();
    return;
  }

  tbody.innerHTML = filtered.map(function(key) {
    return '<tr data-prodkey="' + escapeHtml(key) + '">' + buildCatalogRowCells(key, PRODUCT_MAP[key] || {}) + "</tr>";
  }).join("");
  updateClearBtns();
}

function prodDownloadTemplate() {
  var header = ["Vendor Part #", "NISC Item #", "Name/Description", "Vendor",
    "Tracking Type (serial/reel/none)", "Odoo External ID", "Requires FSAN (yes/no)", "History Only (yes/no)"];
  var example = ["100-05603", "6030", "GS4227 GigaSpire GPON ONT", "Calix",
    "serial", "__export__.product_product_30417_a1e9ec7d", "no", "no"];
  var reelExample = ["", "7142", "144-Strand Single-Mode Fiber", "Corning", "reel", "", "no", "no"];
  var bulkExample = ["", "8201", "CAT6 Cable 1000ft Box", "Belden", "none", "", "no", "no"];
  var lines = [
    header.map(csvEscape).join(","),
    example.map(csvEscape).join(","),
    reelExample.map(csvEscape).join(","),
    bulkExample.map(csvEscape).join(",")
  ];
  downloadText("product-upload-template.csv", lines.join("\n"), "text/csv");
}

function prodBulkUpload(file) {
  if (!file) return;
  var statusEl = $("prodUploadStatus");
  if (statusEl) statusEl.textContent = "Reading file…";

  var reader = new FileReader();
  var isCSV = file.name.toLowerCase().endsWith(".csv");

  reader.onload = function(e) {
    try {
      var wb = isCSV
        ? XLSX.read(e.target.result, { type: "string" })
        : XLSX.read(new Uint8Array(e.target.result), { type: "array" });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
      if (rawRows.length < 2) throw new Error("File appears empty or has no data rows.");

      var headers = rawRows[0].map(function(h) { return normalize(String(h)).toLowerCase(); });
      function col(patterns) {
        return headers.findIndex(function(h) { return patterns.some(function(p) { return p.test(h); }); });
      }
      var colVendorPart   = col([/vendor.?part/i, /^vendor part #$/i]);
      var colNisc         = col([/^default_code$/i, /nisc/i, /hctc/i, /internal.?ref/i]);
      var colName         = col([/^name$/i, /name|description/i]);
      var colVendor       = col([/^vendor$/i]);
      var colTracking     = col([/^tracking$/i, /tracking.?type/i]);
      var colExtId        = col([/^id$/i, /odoo|external.?id/i]);
      var colFsan         = col([/fsan/i]);
      var colHistOnly     = col([/history.?only/i]);
      var colIsReel       = col([/^x_studio_reel$/i, /^is.?reel$/i]);
      var colReelIds      = col([/^reel_ids$/i]);
      var colIsStorable   = col([/^is_storable$/i]);

      if (colNisc === -1 && colVendorPart === -1) {
        throw new Error("Could not find 'Vendor Part #', 'NISC Item #', or 'default_code' column. Download the template to see the expected format.");
      }

      var diff = { added: [], updated: [], unchanged: 0, skipped: 0 };

      rawRows.slice(1).forEach(function(row) {
        // Skip non-storable Odoo products
        if (colIsStorable >= 0) {
          var storableRaw = String(row[colIsStorable]).toLowerCase().trim();
          if (storableRaw === "false" || storableRaw === "0" || storableRaw === "no") {
            diff.skipped++; return;
          }
        }

        var vendorPart = colVendorPart >= 0 ? normalize(String(row[colVendorPart])) : "";
        var niscItem   = colNisc >= 0       ? normalize(String(row[colNisc]))       : "";
        var mapKey     = vendorPart || niscItem;
        if (!mapKey) { diff.skipped++; return; }

        // Tracking resolution: x_studio_reel wins; then Tracking column; old "reel"/"none" text still works
        var isReelFlag   = colIsReel >= 0 ? /true|yes|1/i.test(String(row[colIsReel])) : false;
        var trackingRaw  = colTracking >= 0 ? normalize(String(row[colTracking])).toLowerCase() : "";
        var trackingType;
        if (isReelFlag || trackingRaw === "reel") {
          trackingType = "reel";
        } else if (trackingRaw === "serial" || /serial/i.test(trackingRaw)) {
          trackingType = "serial";
        } else if (trackingRaw === "none" || /no.?tracking/i.test(trackingRaw)) {
          trackingType = "none";
        } else {
          trackingType = colTracking >= 0 ? "none" : "serial"; // explicit col→none, missing col→serial (backwards compat)
        }

        var externalId   = colExtId >= 0    ? normalize(String(row[colExtId]))    : "";
        var requiresFsan = colFsan >= 0     ? /yes|true|1/i.test(String(row[colFsan]))     : false;
        var historyOnly  = colHistOnly >= 0 ? /yes|true|1/i.test(String(row[colHistOnly])) : false;
        var nameVal      = colName >= 0     ? normalize(String(row[colName]))     : "";
        var vendorVal    = colVendor >= 0   ? normalize(String(row[colVendor]))   : "";
        var reelIdsRaw   = colReelIds >= 0  ? normalize(String(row[colReelIds]))  : "";

        var existing = PRODUCT_MAP[mapKey] || {};
        var isNew = !PRODUCT_MAP[mapKey];
        var newEntry = {
          hctc:             niscItem || existing.hctc || vendorPart,
          vendor:           vendorVal || existing.vendor || "",
          name:             nameVal   || existing.name  || "",
          description:      nameVal   || existing.description || "",
          tracking_type:    trackingType,
          serial_tracked:   trackingType === "serial",
          reel_direction:   trackingType === "reel" ? (existing.reel_direction || "one_way") : null,
          odoo_external_id: externalId || existing.odoo_external_id || null,
          external_id:      externalId || existing.external_id      || null,
          requires_fsan:    requiresFsan,
          history_only:     historyOnly,
          reel_ids:         reelIdsRaw || existing.reel_ids || null
        };

        if (isNew) {
          diff.added.push({ key: mapKey, entry: newEntry });
        } else {
          var changes = [];
          _PROD_DIFF_FIELDS.forEach(function(f) {
            var oldVal = String(existing[f.key] || "");
            var newVal = String(newEntry[f.key] || "");
            if (oldVal !== newVal) changes.push({ field: f.label, old: existing[f.key], now: newEntry[f.key] });
          });
          if (changes.length) {
            diff.updated.push({ key: mapKey, entry: newEntry, changes: changes });
          } else {
            diff.unchanged++;
          }
        }
      });

      if (statusEl) statusEl.textContent = "";
      prodShowUploadDiff(diff);
    } catch(err) {
      if (statusEl) statusEl.textContent = "Error: " + err.message;
      alert("Could not parse product file: " + err.message);
      $("prodUploadFile").value = "";
    }
  };

  if (isCSV) reader.readAsText(file); else reader.readAsArrayBuffer(file);
}

function prodShowItemHistory(itemNumber) {
  var map = findProductMapEntry(itemNumber);
  var trackingType = getTrackingType(map);
  var target = normalizeProductKey(itemNumber);

  $("prodHistoryModalTitle").textContent = itemNumber;
  $("prodHistoryModalSubtitle").textContent =
    (map ? (map.name || map.description || "") : "") +
    (map && map.hctc ? "  ·  NISC Item #: " + map.hctc : "");

  $("prodHistoryInfo").innerHTML = [
    map && map.vendor ? "<span><b>Vendor:</b> " + escapeHtml(map.vendor) + "</span>" : "",
    map && map.hctc   ? "<span><b>NISC Item #:</b> " + escapeHtml(map.hctc) + "</span>" : "",
    "<span><b>Tracking:</b> " + escapeHtml(trackingType) + "</span>",
    map && (map.odoo_external_id || map.external_id)
      ? "<span><b>Odoo ID:</b> <small>" + escapeHtml(map.odoo_external_id || map.external_id) + "</small></span>" : ""
  ].filter(Boolean).join("");

  // Receiving history
  var receiving = (history.records || []).filter(function(r) {
    var rProd = normalizeProductKey(r.calix_product || r.product || r.Product || "");
    var rHctc = normalizeProductKey(r.hctc || r.default_code || "");
    return rProd === target || rHctc === target;
  });
  $("prodHistoryReceivingCount").textContent = receiving.length + " record" + (receiving.length !== 1 ? "s" : "");
  $("prodHistoryReceivingBody").innerHTML = receiving.length
    ? receiving.slice(0, 200).map(function(r) {
        return "<tr>" +
          "<td style='white-space:nowrap;'>" + escapeHtml(r.ship_date || r.imported_at || "") + "</td>" +
          "<td>" + escapeHtml(r.source_type || "") + "</td>" +
          "<td>" + escapeHtml(r.rma_number || r.sale_order || "") + "</td>" +
          "<td style='font-family:monospace;'>" + escapeHtml(r.serial || r.ref || "") + "</td>" +
          "<td style='font-family:monospace;'>" + escapeHtml(r.fsan || r.name || "") + "</td>" +
          "<td>" + escapeHtml(r.status || "") + "</td>" +
          "</tr>";
      }).join("")
    : '<tr><td colspan="6" style="color:#94a3b8;text-align:center;padding:12px;">No receiving records.</td></tr>';

  // Finalized inventory events
  var invEvts = (appData.inventory_events || []).filter(function(e) {
    return normalizeProductKey(e.itemNumber || "") === target;
  });
  var sessionMap = {};
  (appData.inventory_sessions || []).forEach(function(s) { sessionMap[s.sessionId] = s; });

  $("prodHistoryInvCount").textContent = invEvts.length + " event" + (invEvts.length !== 1 ? "s" : "") +
    " across " + new Set(invEvts.map(function(e) { return e.sessionId; })).size + " session(s)";

  $("prodHistoryInvBody").innerHTML = invEvts.length
    ? invEvts.slice(0, 300).map(function(e) {
        var sess = sessionMap[e.sessionId] || {};
        var qtyDisplay = e.eventType === "cable_reel_count" && e.totalAvailableFt != null
          ? e.totalAvailableFt.toLocaleString() + " ft"
          : (e.qty != null ? String(e.qty) : "");
        return "<tr>" +
          "<td style='white-space:nowrap;'>" + escapeHtml(sess.sessionName || e.sessionId || "") + "</td>" +
          "<td style='white-space:nowrap;'>" + escapeHtml(sess.closedAt ? invFormatDateTime(sess.closedAt) : "") + "</td>" +
          "<td>" + escapeHtml(e.location || "") + "</td>" +
          "<td><span class='event-type-pill'>" + escapeHtml(e.eventType || "") + "</span></td>" +
          "<td style='text-align:right;font-weight:700;'>" + escapeHtml(qtyDisplay) + "</td>" +
          "<td style='font-family:monospace;'>" + escapeHtml(e.serial || "") + "</td>" +
          "<td>" + escapeHtml(e.notes || "") + "</td>" +
          "</tr>";
      }).join("")
    : '<tr><td colspan="7" style="color:#94a3b8;text-align:center;padding:12px;">No finalized inventory events. Finalize a session to see history here.</td></tr>';

  // Current session events (not yet finalized)
  var currentEvts = invSession ? invEvents.filter(function(e) {
    return normalizeProductKey(e.itemNumber || "") === target && e.status !== "voided";
  }) : [];
  var currentSection = $("prodHistoryCurrentSection");
  if (currentEvts.length && currentSection) {
    currentSection.style.display = "";
    $("prodHistoryCurrentBody").innerHTML = currentEvts.map(function(e) {
      var qtyDisplay = e.eventType === "cable_reel_count" && e.totalAvailableFt != null
        ? e.totalAvailableFt.toLocaleString() + " ft"
        : (e.qty != null ? String(e.qty) : "");
      return "<tr>" +
        "<td>" + (e.sequence != null ? e.sequence : "") + "</td>" +
        "<td style='white-space:nowrap;'>" + invFormatTime(e.timestamp) + "</td>" +
        "<td>" + escapeHtml(e.location || "") + "</td>" +
        "<td><span class='event-type-pill'>" + escapeHtml(e.eventType || "") + "</span></td>" +
        "<td style='text-align:right;font-weight:700;'>" + escapeHtml(qtyDisplay) + "</td>" +
        "<td style='font-family:monospace;'>" + escapeHtml(e.serial || "") + "</td>" +
        "</tr>";
    }).join("");
  } else if (currentSection) {
    currentSection.style.display = "none";
  }

  $("prodHistoryModal").classList.remove("hidden");
}

function prodCloseHistoryModal() {
  var m = $("prodHistoryModal");
  if (m) m.classList.add("hidden");
}

function prodExportMasterJson() {
  appData.product_map = PRODUCT_MAP;
  appData.history = history;
  downloadText(
    "Calix_Odoo_Converter_source_data.json",
    JSON.stringify(buildExportPayload(), null, 2),
    "application/json"
  );
  var banner = $("prodUploadSuccessBanner");
  if (banner) banner.classList.add("hidden");
  var statusEl = $("prodUploadStatus");
  if (statusEl) statusEl.textContent = "Master JSON exported — replace your existing file with the downloaded copy.";
}

// ═══════════════════════════════════════════════════════════════════════
// GAP ANALYSIS — Phase 2: pre-submission comparison vs Quants baseline
// ═══════════════════════════════════════════════════════════════════════

function invRunGapAnalysis() {
  if (!invSession) { alert("Start an inventory session first."); return; }
  if (!invQuantsBaseline.length) { alert("Load a Quants baseline first (Setup → Quants Baseline)."); return; }

  var report = invBuildGapReport();
  invRenderGapReport(report);

  var resultsEl = $("invGapResults");
  if (resultsEl) resultsEl.style.display = "";

  // Auto-expand the card
  var body = $("invGapAnalysisCollapse");
  var hdr  = $("invGapAnalysisHeader");
  if (body && body.style.display === "none") {
    toggleCollapsible("invGapAnalysisCollapse", "invGapAnalysisHeader", "invGapAnalysisChevron");
  }

  var runAt = $("invGapRunAt");
  if (runAt) runAt.textContent = "Run at " + invFormatTime(new Date().toISOString());
}

function invBuildGapReport() {
  var activeEvents = invEvents.filter(function(e) {
    return e.status !== "voided" && e.eventType !== "void_event";
  });

  // Counted reels: normKey(reelNumber) → event
  var countedReels = {};
  // Counted serials: normKey(defCode+"||"+loc+"||"+lotName) → event
  var countedSerials = {};
  // Counted bulk: normKey(defCode+"||"+loc) → {defCode, loc, qty, description}
  var countedBulk = {};

  activeEvents.forEach(function(e) {
    var f = (function(itemNumber) {
      var pm = findProductMapMatch(itemNumber || "");
      return (pm && pm.entry && pm.entry.default_code) ? pm.entry.default_code : (itemNumber || "");
    })(e.itemNumber);
    var defCode = normKey(f);
    var loc     = normKey(e.location || "");

    if (e.eventType === "cable_reel_count") {
      var rn = normKey(e.reelNumber || e.scannedValue || "");
      if (rn) countedReels[rn] = e;
    } else if (e.eventType === "serialized_device_scan") {
      var lot = normKey(e.serial || e.fsan || e.scannedValue || "");
      countedSerials[defCode + "||" + loc + "||" + lot] = e;
    } else if (e.eventType === "bulk_quantity_count" || e.eventType === "box_scan") {
      var bk = defCode + "||" + loc;
      if (!countedBulk[bk]) {
        countedBulk[bk] = { defCode: f, loc: e.location || "", qty: 0, description: e.description || "" };
      }
      countedBulk[bk].qty += (e.eventType === "box_scan")
        ? (e.resolvedDeviceCount || e.qty || 1)
        : (e.qty || 1);
    }
  });

  var serialGaps = [];
  var bulkGaps   = [];
  var reelGaps   = [];

  // Track which counted items matched a quant
  var matchedSerials = {};
  var matchedBulk    = {};
  var matchedReels   = {};

  invQuantsBaseline.forEach(function(q) {
    var defCode = normKey(q.itemNumber);
    var loc     = normKey(q.locationId);

    if (!q.lotId) {
      // ── Bulk quant ──
      var bk      = defCode + "||" + loc;
      matchedBulk[bk] = true;
      var counted = countedBulk[bk];
      if (!counted) {
        bulkGaps.push({ gapType: "not_counted", itemNumber: q.itemNumber, description: q.description, location: q.locationId, odooQty: q.odooQty, countedQty: null });
      } else if (counted.qty !== q.odooQty) {
        bulkGaps.push({ gapType: "qty_mismatch", itemNumber: q.itemNumber, description: q.description, location: q.locationId, odooQty: q.odooQty, countedQty: counted.qty });
      }
    } else {
      var lotNorm = normKey(q.lotId);
      if (countedReels[lotNorm]) {
        // ── Reel quant ──
        matchedReels[lotNorm] = true;
        var reelEvt  = countedReels[lotNorm];
        var countedFt = reelEvt.totalAvailableFt != null ? reelEvt.totalAvailableFt : 0;
        if (Math.abs(countedFt - q.odooQty) > 0.5) {
          reelGaps.push({ gapType: "footage_diff", reelNumber: q.lotId, itemNumber: q.itemNumber, description: q.description, location: q.locationId, odooFt: q.odooQty, countedFt: countedFt });
        }
      } else {
        // ── Serialized quant (or uncounted reel) ──
        var sKey = defCode + "||" + loc + "||" + lotNorm;
        matchedSerials[sKey] = true;
        if (!countedSerials[sKey]) {
          serialGaps.push({ gapType: "missing", itemNumber: q.itemNumber, description: q.description, serial: q.lotId, location: q.locationId });
        }
      }
    }
  });

  // Counted serials with no matching quant
  Object.keys(countedSerials).forEach(function(key) {
    if (!matchedSerials[key]) {
      var e = countedSerials[key];
      serialGaps.push({ gapType: "unexpected", itemNumber: e.itemNumber || "", description: e.description || "", serial: e.serial || e.fsan || e.scannedValue || "", location: e.location || "" });
    }
  });

  // Counted bulk with no matching quant
  Object.keys(countedBulk).forEach(function(bk) {
    if (!matchedBulk[bk]) {
      var r = countedBulk[bk];
      bulkGaps.push({ gapType: "not_in_quants", itemNumber: r.defCode, description: r.description, location: r.loc, odooQty: null, countedQty: r.qty });
    }
  });

  // Counted reels with no matching quant
  Object.keys(countedReels).forEach(function(rn) {
    if (!matchedReels[rn]) {
      var e = countedReels[rn];
      reelGaps.push({ gapType: "not_in_quants", reelNumber: e.reelNumber || e.scannedValue || rn, itemNumber: e.itemNumber || "", description: e.description || "", location: e.location || "", countedFt: e.totalAvailableFt });
    }
  });

  return { serialGaps: serialGaps, bulkGaps: bulkGaps, reelGaps: reelGaps };
}

function invRenderGapReport(report) {
  var totalGaps = report.serialGaps.length + report.bulkGaps.length + report.reelGaps.length;

  // Badge on header
  var badge = $("invGapBadge");
  if (badge) {
    if (totalGaps === 0) {
      badge.textContent = "— no gaps found";
      badge.style.color = "#16a34a";
    } else {
      badge.textContent = "— " + totalGaps + " gap" + (totalGaps !== 1 ? "s" : "");
      badge.style.color = "#b45309";
    }
  }

  // Summary bar chips
  var bar = $("invGapSummaryBar");
  if (bar) {
    function chip(label, count, color) {
      return '<span style="display:inline-flex;align-items:center;gap:5px;background:' + (count ? "#fef3c7" : "#f0fdf4") + ';border:1px solid ' + (count ? "#fcd34d" : "#bbf7d0") + ';border-radius:20px;padding:4px 12px;font-size:12px;font-weight:600;color:' + (count ? "#92400e" : "#166534") + ';">' +
        '<span>' + label + '</span><span style="font-size:14px;">' + count + '</span></span>';
    }
    var missingSerial   = report.serialGaps.filter(function(g){ return g.gapType === "missing"; }).length;
    var unexpectedSerial = report.serialGaps.filter(function(g){ return g.gapType === "unexpected"; }).length;
    var bulkMismatch    = report.bulkGaps.filter(function(g){ return g.gapType === "qty_mismatch"; }).length;
    var bulkNotCounted  = report.bulkGaps.filter(function(g){ return g.gapType === "not_counted"; }).length;
    var bulkExtra       = report.bulkGaps.filter(function(g){ return g.gapType === "not_in_quants"; }).length;
    var reelFtDiff      = report.reelGaps.filter(function(g){ return g.gapType === "footage_diff"; }).length;
    var reelExtra       = report.reelGaps.filter(function(g){ return g.gapType === "not_in_quants"; }).length;
    bar.innerHTML =
      chip("Missing serials", missingSerial) +
      chip("Unexpected serials", unexpectedSerial) +
      chip("Bulk qty mismatch", bulkMismatch) +
      chip("Bulk not counted", bulkNotCounted) +
      chip("Bulk not in quants", bulkExtra) +
      chip("Reel footage diff", reelFtDiff) +
      chip("Reels not in quants", reelExtra);
  }

  // Serialized table
  var serialTitle = $("invGapSerialTitle");
  if (serialTitle) serialTitle.textContent = "Serialized (" + report.serialGaps.length + " gap" + (report.serialGaps.length !== 1 ? "s" : "") + ")";
  var serialTbl = $("invGapSerialTable");
  if (serialTbl) {
    if (!report.serialGaps.length) {
      serialTbl.outerHTML = '<table id="invGapSerialTable"><tbody><tr><td style="color:#16a34a;padding:8px 0;font-size:13px;">&#10003; No serialized gaps</td></tr></tbody></table>';
    } else {
      var rows = '<thead><tr><th>Type</th><th>Item</th><th>Description</th><th>Serial / FSAN</th><th>Location</th></tr></thead><tbody>' +
        report.serialGaps.map(function(g) {
          var typeLabel = g.gapType === "missing" ? '<span style="color:#b91c1c;font-weight:600;">Missing</span>' : '<span style="color:#d97706;font-weight:600;">Unexpected</span>';
          return '<tr><td>' + typeLabel + '</td><td>' + escapeHtml(g.itemNumber) + '</td><td style="max-width:200px;white-space:normal;">' + escapeHtml(g.description) + '</td><td style="font-family:monospace;">' + escapeHtml(g.serial) + '</td><td>' + escapeHtml(g.location) + '</td></tr>';
        }).join("") + '</tbody>';
      serialTbl.outerHTML = '<table id="invGapSerialTable">' + rows + '</table>';
    }
  }

  // Bulk table
  var bulkTitle = $("invGapBulkTitle");
  if (bulkTitle) bulkTitle.textContent = "Bulk (" + report.bulkGaps.length + " gap" + (report.bulkGaps.length !== 1 ? "s" : "") + ")";
  var bulkTbl = $("invGapBulkTable");
  if (bulkTbl) {
    if (!report.bulkGaps.length) {
      bulkTbl.outerHTML = '<table id="invGapBulkTable"><tbody><tr><td style="color:#16a34a;padding:8px 0;font-size:13px;">&#10003; No bulk gaps</td></tr></tbody></table>';
    } else {
      var bulkTypeLabel = { qty_mismatch: '<span style="color:#d97706;font-weight:600;">Qty mismatch</span>', not_counted: '<span style="color:#b91c1c;font-weight:600;">Not counted</span>', not_in_quants: '<span style="color:#7c3aed;font-weight:600;">Not in quants</span>' };
      var brows = '<thead><tr><th>Type</th><th>Item</th><th>Description</th><th>Location</th><th>Odoo Qty</th><th>Counted Qty</th><th>Diff</th></tr></thead><tbody>' +
        report.bulkGaps.map(function(g) {
          var diff = (g.odooQty != null && g.countedQty != null) ? (g.countedQty - g.odooQty) : "—";
          var diffStyle = (typeof diff === "number" && diff !== 0) ? (diff > 0 ? "color:#16a34a;" : "color:#b91c1c;") : "";
          var diffStr = typeof diff === "number" ? (diff > 0 ? "+" + diff : String(diff)) : diff;
          return '<tr>' +
            '<td>' + (bulkTypeLabel[g.gapType] || g.gapType) + '</td>' +
            '<td>' + escapeHtml(g.itemNumber) + '</td>' +
            '<td style="max-width:200px;white-space:normal;">' + escapeHtml(g.description) + '</td>' +
            '<td>' + escapeHtml(g.location) + '</td>' +
            '<td style="text-align:right;">' + (g.odooQty != null ? g.odooQty : "—") + '</td>' +
            '<td style="text-align:right;">' + (g.countedQty != null ? g.countedQty : "—") + '</td>' +
            '<td style="text-align:right;' + diffStyle + '">' + diffStr + '</td>' +
            '</tr>';
        }).join("") + '</tbody>';
      bulkTbl.outerHTML = '<table id="invGapBulkTable">' + brows + '</table>';
    }
  }

  // Reel table
  var reelTitle = $("invGapReelTitle");
  if (reelTitle) reelTitle.textContent = "Reels (" + report.reelGaps.length + " gap" + (report.reelGaps.length !== 1 ? "s" : "") + ")";
  var reelTbl = $("invGapReelTable");
  if (reelTbl) {
    if (!report.reelGaps.length) {
      reelTbl.outerHTML = '<table id="invGapReelTable"><tbody><tr><td style="color:#16a34a;padding:8px 0;font-size:13px;">&#10003; No reel gaps</td></tr></tbody></table>';
    } else {
      var reelTypeLabel = { footage_diff: '<span style="color:#d97706;font-weight:600;">Footage diff</span>', not_in_quants: '<span style="color:#7c3aed;font-weight:600;">Not in quants</span>' };
      var rrows = '<thead><tr><th>Type</th><th>Reel #</th><th>Item</th><th>Description</th><th>Location</th><th>Odoo Ft</th><th>Counted Ft</th></tr></thead><tbody>' +
        report.reelGaps.map(function(g) {
          return '<tr>' +
            '<td>' + (reelTypeLabel[g.gapType] || g.gapType) + '</td>' +
            '<td style="font-family:monospace;">' + escapeHtml(g.reelNumber || "") + '</td>' +
            '<td>' + escapeHtml(g.itemNumber) + '</td>' +
            '<td style="max-width:180px;white-space:normal;">' + escapeHtml(g.description) + '</td>' +
            '<td>' + escapeHtml(g.location) + '</td>' +
            '<td style="text-align:right;">' + (g.odooFt != null ? g.odooFt : "—") + '</td>' +
            '<td style="text-align:right;">' + (g.countedFt != null ? g.countedFt : "—") + '</td>' +
            '</tr>';
        }).join("") + '</tbody>';
      reelTbl.outerHTML = '<table id="invGapReelTable">' + rrows + '</table>';
    }
  }

  // Auto-expand sections that have gaps
  if (report.serialGaps.length) {
    var sb = $("invGapSerialBody");
    if (sb && sb.style.display === "none") toggleCollapsible("invGapSerialBody", "invGapSerialHeader", "invGapSerialChevron");
  }
  if (report.bulkGaps.length) {
    var bb = $("invGapBulkBody");
    if (bb && bb.style.display === "none") toggleCollapsible("invGapBulkBody", "invGapBulkHeader", "invGapBulkChevron");
  }
  if (report.reelGaps.length) {
    var rb = $("invGapReelBody");
    if (rb && rb.style.display === "none") toggleCollapsible("invGapReelBody", "invGapReelHeader", "invGapReelChevron");
  }

  // Show/hide the "Create Recount Session" button based on whether there are gaps
  var rcFromGapBtn = $("rcFromGapBtn");
  if (rcFromGapBtn) rcFromGapBtn.style.display = totalGaps > 0 ? "" : "none";
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3 — RECOUNT SESSIONS (DATA MODEL + SESSION CREATION)
// ═══════════════════════════════════════════════════════════════════════

const RC_STORAGE_KEY = "tim_recount_v1";

let rcSessions        = [];    // array of recount_session objects
let rcMovements       = [];    // array of recount_movement objects (Phase 5)
let rcView            = "list"; // "list" | "create" | "detail"
let rcActiveId        = null;  // recountId of session shown in detail view
let rcCreateGapItems  = null;  // pre-populated items from a gap report

// ── Persistence ────────────────────────────────────────────────────

function rcSaveStorage() {
  TimDB.set(RC_STORAGE_KEY, { sessions: rcSessions, movements: rcMovements, savedAt: invNow() }).catch(function(){});
  appData.recount_sessions  = rcSessions;
  appData.recount_movements = rcMovements;
}

function rcLoadStorage() {
  return TimDB.get(RC_STORAGE_KEY).then(function(saved) {
    if (saved) {
      rcSessions  = Array.isArray(saved.sessions)  ? saved.sessions  : [];
      rcMovements = Array.isArray(saved.movements) ? saved.movements : [];
      appData.recount_sessions  = rcSessions;
      appData.recount_movements = rcMovements;
    }
    rcRenderCard();
  }).catch(function() { rcRenderCard(); });
}

// Called after master JSON is loaded into appData
function rcLoadFromAppData() {
  if (Array.isArray(appData.recount_sessions))  rcSessions  = appData.recount_sessions;
  if (Array.isArray(appData.recount_movements)) rcMovements = appData.recount_movements;
  rcSaveStorage();
  rcRenderCard();
}

// ── ID generators ──────────────────────────────────────────────────

function rcGenSessionId() {
  var d = new Date().toISOString().slice(0, 16).replace(/[T:-]/g, "");
  return "rc_" + d + "_" + Math.random().toString(36).slice(2, 5);
}

function rcGenItemId() {
  return "rci_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
}

// ── Open "create session" from gap report button ───────────────────

function rcOpenCreateFromGaps() {
  var report = invBuildGapReport();
  var totalGaps = report.serialGaps.length + report.bulkGaps.length + report.reelGaps.length;
  if (!totalGaps) { alert("The variance report shows no gaps."); return; }

  rcCreateGapItems = {
    serialized: report.serialGaps.map(function(g) {
      return { rcItemId: rcGenItemId(), itemNumber: g.itemNumber || "", description: g.description || "", location: g.location || "", gapType: g.gapType, serial: g.serial || "", niscExpectedQty: null, status: "pending" };
    }),
    bulk: report.bulkGaps.map(function(g) {
      return { rcItemId: rcGenItemId(), itemNumber: g.itemNumber || "", description: g.description || "", location: g.location || "", gapType: g.gapType, odooQty: g.odooQty != null ? g.odooQty : null, countedQty: g.countedQty != null ? g.countedQty : null, niscExpectedQty: null, status: "pending" };
    }),
    reels: report.reelGaps.map(function(g) {
      return { rcItemId: rcGenItemId(), reelNumber: g.reelNumber || "", itemNumber: g.itemNumber || "", description: g.description || "", location: g.location || "", gapType: g.gapType, odooFt: g.odooFt != null ? g.odooFt : null, countedFt: g.countedFt != null ? g.countedFt : null, niscExpectedQty: null, status: "pending" };
    })
  };

  // Scroll to and open the Recount Sessions card
  var card = $("rcSessionsCard");
  if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
  rcShowCreate(true);
}

// ── View transitions ───────────────────────────────────────────────

function rcShowCreate(fromGaps) {
  rcView = "create";
  rcRenderCard();

  // Auto-fill name
  var n = $("rcCreateName");
  if (n) {
    var num = rcSessions.length + 1;
    var mo  = new Date().toLocaleString("default", { month: "long", year: "numeric" });
    n.value = "Recount #" + num + " – " + mo;
    setTimeout(function(){ if (n) { n.focus(); n.select(); } }, 50);
  }
  var co = $("rcCreateCounters");
  if (co && !co.value) co.value = timGetUsername() || "";

  var par = $("rcCreateParent");
  if (par) par.value = invSession ? (invSession.sessionName || invSession.sessionId) : "(no active inventory session)";

  var gapSum = $("rcCreateGapSummary");
  if (gapSum) {
    if (fromGaps && rcCreateGapItems) {
      var s = rcCreateGapItems.serialized.length;
      var b = rcCreateGapItems.bulk.length;
      var r = rcCreateGapItems.reels.length;
      gapSum.style.display = "";
      gapSum.innerHTML = "<b>Pre-populating from variance report:</b> " + s + " serialized, " + b + " bulk, " + r + " reel gap" + (r !== 1 ? "s" : "") + " — " + (s + b + r) + " items total.";
    } else {
      gapSum.style.display = "none";
      rcCreateGapItems = null;
    }
  }
}

function rcCancelCreate() {
  rcCreateGapItems = null;
  rcView = "list";
  rcRenderCard();
}

function rcConfirmCreate() {
  var nameEl = $("rcCreateName");
  var name = nameEl ? nameEl.value.trim() : "";
  if (!name) { alert("Enter a session name."); if (nameEl) nameEl.focus(); return; }

  var countersRaw = $("rcCreateCounters") ? $("rcCreateCounters").value.trim() : "";
  var counters = countersRaw ? countersRaw.split(",").map(function(s){ return s.trim(); }).filter(Boolean) : [];

  var parentId = invSession ? invSession.sessionId : null;
  var cycleId  = invSession ? (invSession.cycleId || invSession.sessionId) : null;
  var items    = rcCreateGapItems || { serialized: [], bulk: [], reels: [] };

  var session = {
    recountId:   rcGenSessionId(),
    recountName: name,
    cycleId:     cycleId,
    parentId:    parentId,
    counters:    counters,
    createdAt:   invNow(),
    status:      "active",
    closedAt:    null,
    items:       items
  };

  rcSessions.push(session);
  rcCreateGapItems = null;
  rcSaveStorage();

  rcActiveId = session.recountId;
  rcView = "detail";
  rcRenderCard();
}

function rcShowList() {
  rcView    = "list";
  rcActiveId = null;
  rcRenderCard();
}

function rcShowDetail(recountId) {
  rcView    = "detail";
  rcActiveId = recountId;
  rcRenderCard();
}

// ── Card rendering ─────────────────────────────────────────────────

function rcRenderCard() {
  var createForm = $("rcCreateForm");
  var listView   = $("rcListView");
  var detailView = $("rcDetailView");
  if (!listView) return;

  if (rcView === "create") {
    if (createForm) createForm.classList.remove("hidden");
    listView.classList.add("hidden");
    if (detailView) detailView.classList.add("hidden");
    // rcShowCreate fills fields — called separately
  } else if (rcView === "detail") {
    if (createForm) createForm.classList.add("hidden");
    listView.classList.add("hidden");
    if (detailView) { detailView.classList.remove("hidden"); rcRenderDetail(); }
  } else {
    if (createForm) createForm.classList.add("hidden");
    listView.classList.remove("hidden");
    if (detailView) detailView.classList.add("hidden");
    rcRenderList();
  }
}

function rcRenderList() {
  var el = $("rcSessionList");
  if (!el) return;
  if (!rcSessions.length) {
    el.innerHTML = '<div style="color:#94a3b8;padding:20px;text-align:center;border:1px dashed #c7d2fe;border-radius:8px;margin-top:10px;">No recount sessions yet. Run the <b>Variance Report</b> above and click <b>Create Recount Session</b>, or click <b>+ New Session</b> to create one manually.</div>';
    return;
  }
  el.innerHTML = rcSessions.slice().reverse().map(function(s) {
    var total = s.items.serialized.length + s.items.bulk.length + s.items.reels.length;
    var pending = [].concat(s.items.serialized, s.items.bulk, s.items.reels).filter(function(i){ return i.status === "pending"; }).length;
    var date  = s.createdAt ? new Date(s.createdAt).toLocaleDateString() : "";
    var statusBadge = s.status === "active"
      ? '<span style="background:#dbeafe;color:#1d4ed8;border-radius:12px;padding:2px 9px;font-size:11px;font-weight:600;">Active</span>'
      : '<span style="background:#f1f5f9;color:#64748b;border-radius:12px;padding:2px 9px;font-size:11px;font-weight:600;">Closed</span>';
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;">' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-weight:600;font-size:14px;">' + escapeHtml(s.recountName) + '</div>' +
        '<div class="small" style="color:#64748b;margin-top:2px;">' + date +
          (s.counters.length ? ' &bull; ' + escapeHtml(s.counters.join(', ')) : '') +
          ' &bull; ' + (total - pending) + '/' + total + ' addressed' +
        '</div>' +
      '</div>' +
      statusBadge +
      '<button class="secondary" onclick="rcShowDetail(\'' + s.recountId + '\')" style="padding:5px 12px;font-size:13px;">View</button>' +
    '</div>';
  }).join("");
}

function rcRenderDetail() {
  var el = $("rcDetailContent");
  if (!el) return;
  var session = rcSessions.find(function(s){ return s.recountId === rcActiveId; });
  if (!session) { el.innerHTML = "<p>Session not found.</p>"; return; }

  var total   = session.items.serialized.length + session.items.bulk.length + session.items.reels.length;
  var pending = [].concat(session.items.serialized, session.items.bulk, session.items.reels).filter(function(i){ return i.status === "pending"; }).length;

  var html = "";

  // Session header info
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;">' +
    '<div>' +
      '<h3 style="margin:0 0 4px;">' + escapeHtml(session.recountName) + '</h3>' +
      '<div class="small" style="color:#64748b;">' +
        'Created ' + (session.createdAt ? new Date(session.createdAt).toLocaleString() : '') +
        (session.counters.length ? ' &bull; ' + escapeHtml(session.counters.join(', ')) : '') +
      '</div>' +
      (session.parentId ? '<div class="small" style="color:#6366f1;margin-top:2px;">Parent session: ' + escapeHtml(session.parentId) + '</div>' : '') +
    '</div>' +
    '<div style="text-align:right;white-space:nowrap;display:flex;flex-direction:column;align-items:flex-end;gap:6px;">' +
      '<span class="small" style="color:#475569;">' + (total - pending) + '/' + total + ' addressed</span>' +
      '<button onclick="rcExportXlsx(\'' + session.recountId + '\')" style="font-size:12px;padding:4px 12px;">&#8595; Export XLSX</button>' +
    '</div>' +
  '</div>';

  // Three discrepancy type sections
  html += rcRenderDiscrepancySection(session, "serialized");
  html += rcRenderDiscrepancySection(session, "bulk");
  html += rcRenderDiscrepancySection(session, "reels");

  // Manual add row
  html += '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0;">' +
    '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Add Item Manually</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;">' +
      '<label style="font-size:12px;margin:0;">Item #<br><input id="rcManualItemNum" type="text" placeholder="e.g. 6131" style="width:130px;" /></label>' +
      '<label style="font-size:12px;margin:0;">Location (opt.)<br><input id="rcManualLoc" type="text" placeholder="e.g. W367/S/3800" style="width:160px;" /></label>' +
      '<label style="font-size:12px;margin:0;">Type<br><select id="rcManualType" style="width:120px;"><option value="bulk">Bulk</option><option value="serialized">Serialized</option><option value="reels">Reel</option></select></label>' +
      '<button class="secondary" onclick="rcAddManualItem()" style="align-self:flex-end;">+ Add</button>' +
    '</div>' +
  '</div>';

  el.innerHTML = html;
}

function rcRenderDiscrepancySection(session, type) {
  var items   = session.items[type] || [];
  var label   = type === "serialized" ? "Serialized" : type === "bulk" ? "Bulk" : "Reels";
  var sid     = session.recountId.slice(-6);
  var colId   = "rcSec_" + type + "_" + sid;
  var hdrId   = "rcSecHdr_" + type + "_" + sid;
  var chvId   = "rcSecChv_" + type + "_" + sid;

  var html = '<div style="margin-bottom:8px;">' +
    '<div class="collapsible-header" id="' + hdrId + '" onclick="toggleCollapsible(\'' + colId + '\',\'' + hdrId + '\',\'' + chvId + '\')" style="padding:8px 0;border-bottom:1px solid #e2e8f0;">' +
      '<b style="font-size:13px;">' + label + ' <span style="font-weight:400;color:#64748b;">(' + items.length + ')</span></b>' +
      '<svg id="' + chvId + '" class="collapsible-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>' +
    '</div>' +
    '<div id="' + colId + '" class="collapsible-body" style="padding-top:8px;">';

  if (!items.length) {
    html += '<div style="color:#94a3b8;font-size:13px;padding:6px 0;">No ' + label.toLowerCase() + ' discrepancies.</div>';
  } else {
    html += '<div class="scroll"><table style="font-size:13px;">';
    if (type === "serialized") {
      var gapLabelMap = { missing: '<span style="color:#b91c1c;font-weight:600;">Missing</span>', unexpected: '<span style="color:#d97706;font-weight:600;">Unexpected</span>', manual: '<span style="color:#64748b;">Manual</span>' };
      html += '<thead><tr><th>Status</th><th>Gap Type</th><th>Item</th><th>Description</th><th>Serial / FSAN</th><th>Location</th><th>NISC Qty</th><th>Resolution</th><th>Recount</th><th>Movements</th><th></th></tr></thead><tbody>';
      items.forEach(function(item) {
        var statusBadge = item.status === "complete"
          ? '<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;">Done&nbsp;(' + (item.recountedSerials ? item.recountedSerials.length : 0) + ')</span>'
          : '<span style="background:#fef9c3;color:#854d0e;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;">Pending</span>';
        var mvCount = (item.movementIds || []).length;
        html += '<tr>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + (gapLabelMap[item.gapType] || escapeHtml(item.gapType || "")) + '</td>' +
          '<td>' + escapeHtml(item.itemNumber) + '</td>' +
          '<td style="max-width:180px;white-space:normal;">' + escapeHtml(item.description) + '</td>' +
          '<td style="font-family:monospace;">' + escapeHtml(item.serial || "") + '</td>' +
          '<td>' + escapeHtml(item.location) + '</td>' +
          '<td><input type="number" min="0" placeholder="—" value="' + (item.niscExpectedQty != null ? item.niscExpectedQty : "") + '" style="width:68px;" onchange="rcSetNiscQty(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'serialized\',this.value)" /></td>' +
          '<td>' + rcResolutionSelect(session.recountId, item.rcItemId, 'serialized', item.resolutionStatus) + '</td>' +
          '<td><button class="secondary" style="padding:2px 8px;font-size:11px;" onclick="rcOpenWorkflow(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'serialized\')">Recount</button></td>' +
          '<td><button class="secondary" style="padding:2px 8px;font-size:11px;' + (mvCount ? 'background:#ede9fe;color:#5b21b6;border-color:#c4b5fd;' : '') + '" onclick="rcOpenMovementPanel(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'serialized\')">' + (mvCount ? 'Movements (' + mvCount + ')' : 'Movements') + '</button></td>' +
          '<td><button class="secondary danger" title="Remove" style="padding:2px 7px;font-size:11px;" onclick="rcDeleteItem(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'serialized\')">&#215;</button></td>' +
          '</tr>';
      });
    } else if (type === "bulk") {
      var bulkLabelMap = { qty_mismatch: '<span style="color:#d97706;font-weight:600;">Qty mismatch</span>', not_counted: '<span style="color:#b91c1c;font-weight:600;">Not counted</span>', not_in_quants: '<span style="color:#7c3aed;font-weight:600;">Not in quants</span>', manual: '<span style="color:#64748b;">Manual</span>' };
      html += '<thead><tr><th>Status</th><th>Gap Type</th><th>Item</th><th>Description</th><th>Location</th><th>Odoo Qty</th><th>Counted Qty</th><th>NISC Qty</th><th>Resolution</th><th>Recount</th><th>Movements</th><th></th></tr></thead><tbody>';
      items.forEach(function(item) {
        var statusBadge = item.status === "complete"
          ? '<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;">Done&nbsp;(' + item.recountedQty + ')</span>'
          : '<span style="background:#fef9c3;color:#854d0e;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;">Pending</span>';
        var mvCount = (item.movementIds || []).length;
        html += '<tr>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + (bulkLabelMap[item.gapType] || escapeHtml(item.gapType || "")) + '</td>' +
          '<td>' + escapeHtml(item.itemNumber) + '</td>' +
          '<td style="max-width:180px;white-space:normal;">' + escapeHtml(item.description) + '</td>' +
          '<td>' + escapeHtml(item.location) + '</td>' +
          '<td style="text-align:right;">' + (item.odooQty != null ? item.odooQty : "—") + '</td>' +
          '<td style="text-align:right;">' + (item.countedQty != null ? item.countedQty : "—") + '</td>' +
          '<td><input type="number" min="0" placeholder="—" value="' + (item.niscExpectedQty != null ? item.niscExpectedQty : "") + '" style="width:68px;" onchange="rcSetNiscQty(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'bulk\',this.value)" /></td>' +
          '<td>' + rcResolutionSelect(session.recountId, item.rcItemId, 'bulk', item.resolutionStatus) + '</td>' +
          '<td><button class="secondary" style="padding:2px 8px;font-size:11px;" onclick="rcOpenWorkflow(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'bulk\')">Recount</button></td>' +
          '<td><button class="secondary" style="padding:2px 8px;font-size:11px;' + (mvCount ? 'background:#ede9fe;color:#5b21b6;border-color:#c4b5fd;' : '') + '" onclick="rcOpenMovementPanel(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'bulk\')">' + (mvCount ? 'Movements (' + mvCount + ')' : 'Movements') + '</button></td>' +
          '<td><button class="secondary danger" title="Remove" style="padding:2px 7px;font-size:11px;" onclick="rcDeleteItem(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'bulk\')">&#215;</button></td>' +
          '</tr>';
      });
    } else {
      var reelLabelMap = { footage_diff: '<span style="color:#d97706;font-weight:600;">Footage diff</span>', not_in_quants: '<span style="color:#7c3aed;font-weight:600;">Not in quants</span>', manual: '<span style="color:#64748b;">Manual</span>' };
      html += '<thead><tr><th>Status</th><th>Gap Type</th><th>Reel #</th><th>Item</th><th>Description</th><th>Location</th><th>Odoo Ft</th><th>Counted Ft</th><th>NISC Ft</th><th>Resolution</th><th>Recount</th><th>Movements</th><th></th></tr></thead><tbody>';
      items.forEach(function(item) {
        var statusBadge = item.status === "complete"
          ? '<span style="background:#dcfce7;color:#166534;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;">Done&nbsp;(' + item.recountedFt + '&nbsp;ft)</span>'
          : '<span style="background:#fef9c3;color:#854d0e;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;">Pending</span>';
        var mvCount = (item.movementIds || []).length;
        html += '<tr>' +
          '<td>' + statusBadge + '</td>' +
          '<td>' + (reelLabelMap[item.gapType] || escapeHtml(item.gapType || "")) + '</td>' +
          '<td style="font-family:monospace;">' + escapeHtml(item.reelNumber || "") + '</td>' +
          '<td>' + escapeHtml(item.itemNumber) + '</td>' +
          '<td style="max-width:180px;white-space:normal;">' + escapeHtml(item.description) + '</td>' +
          '<td>' + escapeHtml(item.location) + '</td>' +
          '<td style="text-align:right;">' + (item.odooFt != null ? item.odooFt : "—") + '</td>' +
          '<td style="text-align:right;">' + (item.countedFt != null ? item.countedFt : "—") + '</td>' +
          '<td><input type="number" min="0" placeholder="—" value="' + (item.niscExpectedQty != null ? item.niscExpectedQty : "") + '" style="width:78px;" onchange="rcSetNiscQty(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'reels\',this.value)" /></td>' +
          '<td>' + rcResolutionSelect(session.recountId, item.rcItemId, 'reels', item.resolutionStatus) + '</td>' +
          '<td><button class="secondary" style="padding:2px 8px;font-size:11px;" onclick="rcOpenWorkflow(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'reels\')">Recount</button></td>' +
          '<td><button class="secondary" style="padding:2px 8px;font-size:11px;' + (mvCount ? 'background:#ede9fe;color:#5b21b6;border-color:#c4b5fd;' : '') + '" onclick="rcOpenMovementPanel(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'reels\')">' + (mvCount ? 'Movements (' + mvCount + ')' : 'Movements') + '</button></td>' +
          '<td><button class="secondary danger" title="Remove" style="padding:2px 7px;font-size:11px;" onclick="rcDeleteItem(\'' + session.recountId + '\',\'' + item.rcItemId + '\',\'reels\')">&#215;</button></td>' +
          '</tr>';
      });
    }
    html += '</tbody></table></div>';
  }

  html += '</div></div>';
  return html;
}

// ── Item mutation functions ─────────────────────────────────────────

function rcSetNiscQty(recountId, rcItemId, type, val) {
  var session = rcSessions.find(function(s){ return s.recountId === recountId; });
  if (!session) return;
  var item = (session.items[type] || []).find(function(i){ return i.rcItemId === rcItemId; });
  if (!item) return;
  var n = parseFloat(val);
  item.niscExpectedQty = (val === "" || isNaN(n)) ? null : n;
  rcSaveStorage();
}

function rcDeleteItem(recountId, rcItemId, type) {
  var session = rcSessions.find(function(s){ return s.recountId === rcActiveId; });
  if (!session) return;
  session.items[type] = (session.items[type] || []).filter(function(i){ return i.rcItemId !== rcItemId; });
  rcSaveStorage();
  rcRenderDetail();
}

function rcAddManualItem() {
  if (!rcActiveId) return;
  var session = rcSessions.find(function(s){ return s.recountId === rcActiveId; });
  if (!session) return;

  var itemNum = $("rcManualItemNum") ? $("rcManualItemNum").value.trim() : "";
  var loc     = $("rcManualLoc")     ? $("rcManualLoc").value.trim()     : "";
  var type    = $("rcManualType")    ? $("rcManualType").value           : "bulk";

  if (!itemNum) { alert("Enter an item number."); if ($("rcManualItemNum")) $("rcManualItemNum").focus(); return; }

  var pm = findProductMapMatch(itemNum);
  var description = (pm && pm.entry) ? (pm.entry.name || pm.entry.description || "") : "";

  var newItem;
  if (type === "serialized") {
    newItem = { rcItemId: rcGenItemId(), itemNumber: itemNum, description: description, location: loc, gapType: "manual", serial: "", niscExpectedQty: null, status: "pending" };
  } else if (type === "reels") {
    newItem = { rcItemId: rcGenItemId(), reelNumber: "", itemNumber: itemNum, description: description, location: loc, gapType: "manual", odooFt: null, countedFt: null, niscExpectedQty: null, status: "pending" };
  } else {
    newItem = { rcItemId: rcGenItemId(), itemNumber: itemNum, description: description, location: loc, gapType: "manual", odooQty: null, countedQty: null, niscExpectedQty: null, status: "pending" };
  }

  session.items[type].push(newItem);
  rcSaveStorage();
  if ($("rcManualItemNum")) $("rcManualItemNum").value = "";
  if ($("rcManualLoc"))     $("rcManualLoc").value     = "";
  rcRenderDetail();
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4 — PHYSICAL RECOUNT WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════

var rcWfState = null; // { recountId, rcItemId, type, scannedSerials[] }

function rcOpenWorkflow(recountId, rcItemId, type) {
  var session = rcSessions.find(function(s){ return s.recountId === recountId; });
  if (!session) return;
  var item = (session.items[type] || []).find(function(i){ return i.rcItemId === rcItemId; });
  if (!item) return;

  rcWfState = { recountId: recountId, rcItemId: rcItemId, type: type, scannedSerials: [] };

  var titleEl    = $("rcWfTitle");
  var subtitleEl = $("rcWfSubtitle");
  var bodyEl     = $("rcWfBody");
  var confirmBtn = $("rcWfConfirmBtn");

  var typeLabel = type === "serialized" ? "Serialized" : type === "bulk" ? "Bulk" : "Reel";
  if (titleEl)    titleEl.textContent    = typeLabel + " Physical Recount";
  if (subtitleEl) subtitleEl.textContent = escapeHtml(item.itemNumber) + (item.description ? " — " + item.description : "") + (item.location ? " · " + item.location : "");
  if (confirmBtn) confirmBtn.textContent = "Confirm Recount";

  if (bodyEl) {
    if (type === "serialized") {
      // Pre-load any previously scanned serials
      var existing = item.recountedSerials || [];
      rcWfState.scannedSerials = existing.slice();
      bodyEl.innerHTML = rcWfBuildSerialBody(item);
    } else if (type === "bulk") {
      bodyEl.innerHTML = rcWfBuildBulkBody(item);
    } else {
      bodyEl.innerHTML = rcWfBuildReelBody(item);
    }
  }

  var modal = $("rcWorkflowModal");
  if (modal) modal.classList.remove("hidden");

  setTimeout(function() {
    if (type === "serialized") {
      var si = $("rcWfScanInput"); if (si) { si.focus(); si.select(); }
    } else if (type === "bulk") {
      var qi = $("rcWfQtyInput"); if (qi) { qi.focus(); qi.select(); }
    } else {
      var ia = $("rcWfInnerA"); if (ia) { ia.focus(); ia.select(); }
    }
  }, 80);
}

function rcCloseWorkflow() {
  var modal = $("rcWorkflowModal");
  if (modal) modal.classList.add("hidden");
  rcWfState = null;
}

// ── Serialized body ─────────────────────────────────────────────────────

function rcWfBuildSerialBody(item) {
  var listHtml = "";
  if (rcWfState.scannedSerials.length) {
    listHtml = rcWfState.scannedSerials.map(function(s, i) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #f1f5f9;">' +
        '<span style="font-family:monospace;font-size:13px;flex:1;">' + escapeHtml(s) + '</span>' +
        '<button class="secondary danger" style="padding:1px 6px;font-size:11px;" onclick="rcWfRemoveSerial(' + i + ')">&#215;</button>' +
        '</div>';
    }).join("");
  } else {
    listHtml = '<div style="color:#94a3b8;font-size:13px;padding:6px 0;">No serials scanned yet.</div>';
  }

  return '<div style="margin-bottom:14px;">' +
    '<p style="margin:0 0 10px;font-size:13px;color:#475569;">Scan all serials for this SKU. Each scan replaces the original count entry.</p>' +
    '<div style="display:flex;gap:8px;margin-bottom:12px;">' +
      '<input id="rcWfScanInput" type="text" placeholder="Scan serial / FSAN…" style="flex:1;" ' +
        'onkeydown="rcWfScanKeydown(event)" />' +
      '<button onclick="rcWfScanAdd()" style="margin:0;">Add</button>' +
    '</div>' +
    '<div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:6px;">' +
      'Scanned: <span id="rcWfSerialCount">' + rcWfState.scannedSerials.length + '</span>' +
    '</div>' +
    '<div id="rcWfSerialList" style="max-height:220px;overflow-y:auto;">' + listHtml + '</div>' +
  '</div>';
}

function rcWfScanKeydown(e) {
  if (e.key === "Enter") { e.preventDefault(); rcWfScanAdd(); }
}

function rcWfScanAdd() {
  var inp = $("rcWfScanInput");
  if (!inp) return;
  var val = sanitizeScannerValue(inp.value || "", { uppercase: true });
  if (!val) { inp.focus(); return; }
  if (rcWfState.scannedSerials.indexOf(val) !== -1) {
    inp.value = "";
    inp.placeholder = val + " already scanned";
    setTimeout(function(){ inp.placeholder = "Scan serial / FSAN…"; }, 1800);
    inp.focus();
    return;
  }
  rcWfState.scannedSerials.push(val);
  inp.value = "";
  inp.focus();
  rcWfRefreshSerialList();
}

function rcWfRemoveSerial(idx) {
  rcWfState.scannedSerials.splice(idx, 1);
  rcWfRefreshSerialList();
  setTimeout(function(){ var si = $("rcWfScanInput"); if (si) si.focus(); }, 40);
}

function rcWfRefreshSerialList() {
  var countEl = $("rcWfSerialCount");
  var listEl  = $("rcWfSerialList");
  if (countEl) countEl.textContent = rcWfState.scannedSerials.length;
  if (!listEl) return;
  if (!rcWfState.scannedSerials.length) {
    listEl.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:6px 0;">No serials scanned yet.</div>';
    return;
  }
  listEl.innerHTML = rcWfState.scannedSerials.map(function(s, i) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid #f1f5f9;">' +
      '<span style="font-family:monospace;font-size:13px;flex:1;">' + escapeHtml(s) + '</span>' +
      '<button class="secondary danger" style="padding:1px 6px;font-size:11px;" onclick="rcWfRemoveSerial(' + i + ')">&#215;</button>' +
      '</div>';
  }).join("");
}

// ── Bulk body ────────────────────────────────────────────────────────────

function rcWfBuildBulkBody(item) {
  var prev = item.recountedQty != null ? item.recountedQty : "";
  return '<div>' +
    '<p style="margin:0 0 12px;font-size:13px;color:#475569;">Enter the physical count quantity for this item/location.</p>' +
    '<div style="display:flex;flex-direction:column;gap:10px;max-width:260px;">' +
      (item.odooQty != null ? '<div style="font-size:13px;">Odoo qty: <b>' + item.odooQty + '</b></div>' : '') +
      (item.countedQty != null ? '<div style="font-size:13px;">Previous count: <b>' + item.countedQty + '</b></div>' : '') +
      (item.niscExpectedQty != null ? '<div style="font-size:13px;">NISC expected: <b>' + item.niscExpectedQty + '</b></div>' : '') +
      '<label style="font-size:13px;font-weight:600;">New recount qty' +
        '<input id="rcWfQtyInput" type="number" min="0" step="1" value="' + prev + '" ' +
          'style="margin-top:6px;display:block;width:140px;" />' +
      '</label>' +
    '</div>' +
  '</div>';
}

// ── Reel body ────────────────────────────────────────────────────────────

function rcWfBuildReelBody(item) {
  var prevInner = item.innerSeqA != null ? item.innerSeqA : "";
  var prevOuter = item.outerSeqA != null ? item.outerSeqA : "";
  var prevFt    = item.recountedFt != null ? item.recountedFt : "";
  return '<div>' +
    '<p style="margin:0 0 12px;font-size:13px;color:#475569;">Enter the sequence numbers from the reel. Footage = Outer − Inner.</p>' +
    '<div style="display:flex;flex-direction:column;gap:10px;max-width:280px;">' +
      (item.reelNumber ? '<div style="font-size:13px;">Reel #: <b style="font-family:monospace;">' + escapeHtml(item.reelNumber) + '</b></div>' : '') +
      (item.odooFt != null ? '<div style="font-size:13px;">Odoo footage: <b>' + item.odooFt + '</b></div>' : '') +
      (item.countedFt != null ? '<div style="font-size:13px;">Previous count: <b>' + item.countedFt + '</b></div>' : '') +
      (item.niscExpectedQty != null ? '<div style="font-size:13px;">NISC expected: <b>' + item.niscExpectedQty + ' ft</b></div>' : '') +
      '<div style="display:flex;gap:12px;">' +
        '<label style="font-size:13px;font-weight:600;">Inner sequence' +
          '<input id="rcWfInnerA" type="number" min="0" step="1" value="' + prevInner + '" ' +
            'style="margin-top:6px;display:block;width:120px;" oninput="rcWfCalcFt()" />' +
        '</label>' +
        '<label style="font-size:13px;font-weight:600;">Outer sequence' +
          '<input id="rcWfOuterA" type="number" min="0" step="1" value="' + prevOuter + '" ' +
            'style="margin-top:6px;display:block;width:120px;" oninput="rcWfCalcFt()" />' +
        '</label>' +
      '</div>' +
      '<div id="rcWfFtDisplay" style="font-size:14px;font-weight:600;color:#1e40af;min-height:22px;">' +
        (prevInner !== "" && prevOuter !== "" ? "Footage: " + Math.max(0, Number(prevOuter) - Number(prevInner)) + " ft" : "") +
      '</div>' +
    '</div>' +
  '</div>';
}

function rcWfCalcFt() {
  var inner = parseFloat(($("rcWfInnerA") || {}).value || "");
  var outer = parseFloat(($("rcWfOuterA") || {}).value || "");
  var el    = $("rcWfFtDisplay");
  if (!el) return;
  if (!isNaN(inner) && !isNaN(outer)) {
    var ft = Math.max(0, outer - inner);
    el.textContent = "Footage: " + ft + " ft";
  } else {
    el.textContent = "";
  }
}

// ── Confirm ──────────────────────────────────────────────────────────────

function rcWorkflowConfirm() {
  if (!rcWfState) return;
  var s = rcWfState;
  var session = rcSessions.find(function(ss){ return ss.recountId === s.recountId; });
  if (!session) return;
  var item = (session.items[s.type] || []).find(function(i){ return i.rcItemId === s.rcItemId; });
  if (!item) return;

  if (s.type === "serialized") {
    if (!rcWfState.scannedSerials.length) {
      alert("Scan at least one serial before confirming.");
      return;
    }
    item.recountedSerials = rcWfState.scannedSerials.slice();
    item.status           = "complete";
  } else if (s.type === "bulk") {
    var qtyEl = $("rcWfQtyInput");
    var qtyVal = qtyEl ? qtyEl.value.trim() : "";
    if (qtyVal === "" || isNaN(parseFloat(qtyVal))) {
      alert("Enter a valid quantity.");
      if (qtyEl) qtyEl.focus();
      return;
    }
    item.recountedQty = parseFloat(qtyVal);
    item.status       = "complete";
  } else {
    var innerEl = $("rcWfInnerA");
    var outerEl = $("rcWfOuterA");
    var innerVal = innerEl ? innerEl.value.trim() : "";
    var outerVal = outerEl ? outerEl.value.trim() : "";
    if (innerVal === "" || outerVal === "" || isNaN(parseFloat(innerVal)) || isNaN(parseFloat(outerVal))) {
      alert("Enter both inner and outer sequence numbers.");
      if (innerEl) innerEl.focus();
      return;
    }
    item.innerSeqA    = parseFloat(innerVal);
    item.outerSeqA    = parseFloat(outerVal);
    item.recountedFt  = Math.max(0, item.outerSeqA - item.innerSeqA);
    item.status       = "complete";
  }

  rcSaveStorage();
  rcCloseWorkflow();
  rcRenderDetail();
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 5 — MOVEMENT RECORDS & RESOLUTION STATUS
// ═══════════════════════════════════════════════════════════════════════

var rcMvState = null; // { recountId, rcItemId, type }

var RC_RESOLUTION_OPTIONS = [
  { value: "",                  label: "— unresolved —" },
  { value: "confirmed_correct", label: "Confirmed Correct" },
  { value: "adjusted_up",       label: "Adjusted Up" },
  { value: "adjusted_down",     label: "Adjusted Down" },
  { value: "product_movement",  label: "Product Movement" },
  { value: "unable_to_locate",  label: "Unable to Locate" }
];

function rcResolutionSelect(recountId, rcItemId, type, currentVal) {
  var val = currentVal || "";
  var opts = RC_RESOLUTION_OPTIONS.map(function(o) {
    return '<option value="' + o.value + '"' + (o.value === val ? ' selected' : '') + '>' + o.label + '</option>';
  }).join("");
  return '<select style="font-size:11px;width:140px;" onchange="rcSetResolution(\'' + recountId + '\',\'' + rcItemId + '\',\'' + type + '\',this.value)">' + opts + '</select>';
}

function rcSetResolution(recountId, rcItemId, type, val) {
  var session = rcSessions.find(function(s){ return s.recountId === recountId; });
  if (!session) return;
  var item = (session.items[type] || []).find(function(i){ return i.rcItemId === rcItemId; });
  if (!item) return;
  item.resolutionStatus = val || null;
  rcSaveStorage();
}

function rcGenMovementId() {
  return "mv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 5);
}

// ── Movement panel open / close ─────────────────────────────────────────

function rcOpenMovementPanel(recountId, rcItemId, type) {
  var session = rcSessions.find(function(s){ return s.recountId === recountId; });
  if (!session) return;
  var item = (session.items[type] || []).find(function(i){ return i.rcItemId === rcItemId; });
  if (!item) return;

  rcMvState = { recountId: recountId, rcItemId: rcItemId, type: type };

  var titleEl    = $("rcMvTitle");
  var subtitleEl = $("rcMvSubtitle");
  if (titleEl)    titleEl.textContent = "Movement Records";
  if (subtitleEl) subtitleEl.textContent = item.itemNumber + (item.description ? " — " + item.description : "") + (item.location ? " · " + item.location : "");

  rcRenderMovementPanel();
  var modal = $("rcMovementModal");
  if (modal) modal.classList.remove("hidden");
}

function rcCloseMovementPanel() {
  var modal = $("rcMovementModal");
  if (modal) modal.classList.add("hidden");
  rcMvState = null;
  // Re-render detail so movement count badges refresh
  if (rcView === "detail") rcRenderDetail();
}

// ── Movement panel render ───────────────────────────────────────────────

function rcRenderMovementPanel() {
  var bodyEl = $("rcMvBody");
  if (!bodyEl || !rcMvState) return;

  var session = rcSessions.find(function(s){ return s.recountId === rcMvState.recountId; });
  if (!session) return;
  var item = (session.items[rcMvState.type] || []).find(function(i){ return i.rcItemId === rcMvState.rcItemId; });
  if (!item) return;

  var attachedIds = item.movementIds || [];
  var attachedMvs = attachedIds.map(function(id){ return rcMovements.find(function(m){ return m.movementId === id; }); }).filter(Boolean);
  var unattached  = rcMovements.filter(function(m){ return attachedIds.indexOf(m.movementId) === -1; });

  var html = "";

  // Attached movements list
  html += '<div style="margin-bottom:18px;">';
  html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Attached Movements <span style="font-weight:400;color:#64748b;">(' + attachedMvs.length + ')</span></div>';
  if (!attachedMvs.length) {
    html += '<div style="color:#94a3b8;font-size:13px;padding:10px;border:1px dashed #cbd5e1;border-radius:6px;text-align:center;">No movements attached yet.</div>';
  } else {
    html += attachedMvs.map(function(m){ return rcRenderMovementCard(m, true); }).join("");
  }
  html += '</div>';

  // Attach existing (only shown when there are unattached global movements)
  if (unattached.length) {
    html += '<div style="margin-bottom:18px;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">';
    html += '<div style="font-weight:600;font-size:13px;margin-bottom:8px;">Attach Existing Movement</div>';
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
    html += '<select id="rcMvAttachSelect" style="flex:1;min-width:220px;">';
    html += unattached.map(function(m) {
      var typeLabels = { fulfillment: "Fulfillment", transfer: "Transfer", return: "Return", JE: "Journal Entry", work_order: "Work Order", expense: "Expense", other: "Other" };
      var label = escapeHtml((m.transactionNumber || "(no #)") + " — " + (typeLabels[m.transactionType] || m.transactionType || "") + " — " + (m.system || "") + (m.qtyMoved != null ? " (qty " + m.qtyMoved + ")" : ""));
      return '<option value="' + m.movementId + '">' + label + '</option>';
    }).join("");
    html += '</select><button onclick="rcMvAttachExisting()" style="margin:0;white-space:nowrap;">Attach</button>';
    html += '</div></div>';
  }

  // Create new movement form
  html += '<div style="padding:14px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">';
  html += '<div style="font-weight:600;font-size:13px;margin-bottom:12px;">Create New Movement Record</div>';
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">';
  html += '<label style="font-size:12px;font-weight:600;">Transaction / Order #<br><input id="rcMvTxNum" type="text" placeholder="SO-1234, JE-5678…" style="width:100%;margin-top:4px;" /></label>';
  html += '<label style="font-size:12px;font-weight:600;">System<br><select id="rcMvSystem" style="width:100%;margin-top:4px;"><option value="Odoo">Odoo</option><option value="NISC">NISC</option></select></label>';
  html += '<label style="font-size:12px;font-weight:600;">Transaction Type<br><select id="rcMvTxType" style="width:100%;margin-top:4px;"><option value="fulfillment">Fulfillment</option><option value="transfer">Transfer</option><option value="return">Return</option><option value="JE">Journal Entry</option><option value="work_order">Work Order</option><option value="expense">Expense</option><option value="other">Other</option></select></label>';
  html += '<label style="font-size:12px;font-weight:600;">Qty Moved<br><input id="rcMvQty" type="number" step="any" placeholder="0" style="width:100%;margin-top:4px;" /></label>';
  html += '<label style="font-size:12px;font-weight:600;">Customer<br><input id="rcMvCustomer" type="text" placeholder="Customer name" style="width:100%;margin-top:4px;" /></label>';
  html += '<label style="font-size:12px;font-weight:600;">Responsible<br><input id="rcMvResponsible" type="text" placeholder="Employee name" style="width:100%;margin-top:4px;" /></label>';
  html += '<label style="font-size:12px;font-weight:600;">Date<br><input id="rcMvDate" type="date" style="width:100%;margin-top:4px;" /></label>';
  html += '<label style="font-size:12px;font-weight:600;">Correctly Accounted?<br><select id="rcMvAccounted" style="width:100%;margin-top:4px;"><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></label>';
  html += '</div>';
  html += '<label style="font-size:12px;font-weight:600;display:block;margin-top:10px;">Notes<br><textarea id="rcMvNotes" rows="2" placeholder="Optional notes…" style="width:100%;margin-top:4px;resize:vertical;box-sizing:border-box;"></textarea></label>';
  html += '<div style="margin-top:12px;text-align:right;"><button onclick="rcMvCreateAndAttach()" style="margin:0;">Create &amp; Attach</button></div>';
  html += '</div>';

  bodyEl.innerHTML = html;
}

function rcRenderMovementCard(m, canDetach) {
  var typeLabels = { fulfillment: "Fulfillment", transfer: "Transfer", return: "Return", JE: "Journal Entry", work_order: "Work Order", expense: "Expense", other: "Other" };
  var acctColor = m.correctlyAccounted === "yes" ? "#166534" : m.correctlyAccounted === "no" ? "#b91c1c" : "#64748b";
  var acctBg    = m.correctlyAccounted === "yes" ? "#dcfce7" : m.correctlyAccounted === "no" ? "#fee2e2" : "#f1f5f9";
  var acctText  = m.correctlyAccounted === "yes" ? "Accounted ✓" : m.correctlyAccounted === "no" ? "NOT accounted" : "Acctg unknown";

  var html = '<div style="border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fff;">';
  html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">';
  html += '<div style="flex:1;">';
  html += '<div style="font-weight:600;font-size:13px;">' + escapeHtml(m.transactionNumber || "(no transaction #)") + '</div>';
  html += '<div class="small" style="color:#475569;margin-top:2px;">';
  html += escapeHtml(m.system || "") + (m.transactionType ? " · " + escapeHtml(typeLabels[m.transactionType] || m.transactionType) : "");
  if (m.qtyMoved != null) html += " · Qty " + m.qtyMoved;
  if (m.date) html += " · " + escapeHtml(m.date);
  html += '</div>';
  if (m.customer || m.responsible) {
    html += '<div class="small" style="color:#64748b;margin-top:2px;">';
    if (m.customer) html += "Customer: " + escapeHtml(m.customer) + (m.responsible ? " " : "");
    if (m.responsible) html += "Responsible: " + escapeHtml(m.responsible);
    html += '</div>';
  }
  if (m.notes) html += '<div class="small" style="color:#64748b;font-style:italic;margin-top:2px;">' + escapeHtml(m.notes) + '</div>';
  html += '</div>';
  html += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">';
  html += '<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:' + acctBg + ';color:' + acctColor + ';">' + acctText + '</span>';
  if (canDetach) {
    html += '<button class="secondary danger" style="padding:2px 8px;font-size:11px;" onclick="rcMvDetach(\'' + m.movementId + '\')">Detach</button>';
  }
  html += '</div></div></div>';
  return html;
}

// ── Attach existing ─────────────────────────────────────────────────────

function rcMvAttachExisting() {
  if (!rcMvState) return;
  var sel = $("rcMvAttachSelect");
  if (!sel || !sel.value) return;
  var session = rcSessions.find(function(s){ return s.recountId === rcMvState.recountId; });
  if (!session) return;
  var item = (session.items[rcMvState.type] || []).find(function(i){ return i.rcItemId === rcMvState.rcItemId; });
  if (!item) return;
  if (!Array.isArray(item.movementIds)) item.movementIds = [];
  if (item.movementIds.indexOf(sel.value) === -1) item.movementIds.push(sel.value);
  rcSaveStorage();
  rcRenderMovementPanel();
}

// ── Detach ──────────────────────────────────────────────────────────────

function rcMvDetach(movementId) {
  if (!rcMvState) return;
  var session = rcSessions.find(function(s){ return s.recountId === rcMvState.recountId; });
  if (!session) return;
  var item = (session.items[rcMvState.type] || []).find(function(i){ return i.rcItemId === rcMvState.rcItemId; });
  if (!item || !Array.isArray(item.movementIds)) return;
  item.movementIds = item.movementIds.filter(function(id){ return id !== movementId; });
  rcSaveStorage();
  rcRenderMovementPanel();
}

// ── Create and attach ───────────────────────────────────────────────────

function rcMvCreateAndAttach() {
  if (!rcMvState) return;
  var txNumEl = $("rcMvTxNum");
  var txNum   = txNumEl ? txNumEl.value.trim() : "";
  if (!txNum) { alert("Enter a transaction / order number."); if (txNumEl) txNumEl.focus(); return; }

  var qtyRaw = $("rcMvQty") ? $("rcMvQty").value.trim() : "";
  var qty    = qtyRaw !== "" ? parseFloat(qtyRaw) : null;

  var mv = {
    movementId:         rcGenMovementId(),
    transactionNumber:  txNum,
    system:             $("rcMvSystem")      ? $("rcMvSystem").value      : "Odoo",
    transactionType:    $("rcMvTxType")      ? $("rcMvTxType").value      : "other",
    qtyMoved:           (qty !== null && !isNaN(qty)) ? qty : null,
    customer:           $("rcMvCustomer")    ? $("rcMvCustomer").value.trim()    : "",
    responsible:        $("rcMvResponsible") ? $("rcMvResponsible").value.trim() : "",
    date:               $("rcMvDate")        ? $("rcMvDate").value               : "",
    correctlyAccounted: $("rcMvAccounted")   ? $("rcMvAccounted").value          : "unknown",
    notes:              $("rcMvNotes")       ? $("rcMvNotes").value.trim()       : ""
  };

  rcMovements.push(mv);

  // Attach to current item
  var session = rcSessions.find(function(s){ return s.recountId === rcMvState.recountId; });
  if (session) {
    var item = (session.items[rcMvState.type] || []).find(function(i){ return i.rcItemId === rcMvState.rcItemId; });
    if (item) {
      if (!Array.isArray(item.movementIds)) item.movementIds = [];
      item.movementIds.push(mv.movementId);
    }
  }

  rcSaveStorage();
  rcRenderMovementPanel();
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 6 — RECOUNT XLSX EXPORT
// Three-tab workbook: Serialized / Bulk / Reels
// Each row includes: item info, discrepancy context, recount result,
// resolution status, movements summary, and prior-count chain history.
// ═══════════════════════════════════════════════════════════════════════

function rcBuildChain(session) {
  // Returns ordered array of { sessionId, sessionName, sessionType:"inventory"|"recount", closedAt }
  // from oldest ancestor to this session, for display in the "Prior Count History" columns.
  var chain = [];
  var visited = new Set();

  function walk(id) {
    if (!id || visited.has(id)) return;
    visited.add(id);
    // Is it a recount session?
    var rc = rcSessions.find(function(s){ return s.recountId === id; });
    if (rc) {
      walk(rc.parentId);
      chain.push({ sessionId: rc.recountId, sessionName: rc.recountName, sessionType: "recount", closedAt: rc.closedAt || "" });
      return;
    }
    // Is it an inventory session?
    var inv = (appData.inventory_sessions || []).find(function(s){ return s.sessionId === id; });
    if (inv) {
      chain.push({ sessionId: inv.sessionId, sessionName: inv.sessionName || inv.sessionId, sessionType: "inventory", closedAt: inv.closedAt || "" });
    }
  }

  // Walk from parentId; this session itself is the current recount being exported
  walk(session.parentId);
  return chain;
}

function rcChainHistoryForItem(chain, item, type) {
  // For each session in the chain, find the most recent count for this item and return a summary string.
  // Returns array of strings, one per chain entry, in chain order.
  var allEvents = appData.inventory_events || [];
  return chain.map(function(node) {
    if (node.sessionType === "inventory") {
      if (type === "serialized") {
        var evts = allEvents.filter(function(e){
          return e.sessionId === node.sessionId && e.status !== "voided" &&
                 (e.itemNumber === item.itemNumber || e.defCode === item.itemNumber) &&
                 (e.serial || e.fsan);
        });
        if (!evts.length) return "—";
        return evts.map(function(e){ return e.serial || e.fsan || ""; }).join(", ");
      }
      if (type === "bulk") {
        var evts = allEvents.filter(function(e){
          return e.sessionId === node.sessionId && e.status !== "voided" &&
                 (e.itemNumber === item.itemNumber || e.defCode === item.itemNumber) &&
                 e.location === item.location && e.qty != null;
        });
        if (!evts.length) return "—";
        var total = evts.reduce(function(s,e){ return s + (e.qty||0); }, 0);
        return String(total);
      }
      if (type === "reels") {
        var evts = allEvents.filter(function(e){
          return e.sessionId === node.sessionId && e.status !== "voided" &&
                 e.eventType === "cable_reel_count" &&
                 normKey(e.reelNumber || "") === normKey(item.reelNumber || "");
        });
        if (!evts.length) return "—";
        var last = evts[evts.length - 1];
        return (last.totalAvailableFt != null ? last.totalAvailableFt + " ft" : "—");
      }
    }
    if (node.sessionType === "recount") {
      var rcSess = rcSessions.find(function(s){ return s.recountId === node.sessionId; });
      if (!rcSess) return "—";
      var rcItems = rcSess.items[type] || [];
      var match = rcItems.find(function(i){ return i.rcItemId === item.rcItemId || (
        type === "reels" ? normKey(i.reelNumber||"") === normKey(item.reelNumber||"") :
        (i.itemNumber === item.itemNumber && (type === "serialized" ? (i.serial||"") === (item.serial||"") : i.location === item.location))
      ); });
      if (!match || match.status !== "complete") return "—";
      if (type === "serialized") return (match.recountedSerials || []).join(", ") || "—";
      if (type === "bulk")       return match.recountedQty != null ? String(match.recountedQty) : "—";
      if (type === "reels")      return match.recountedFt  != null ? match.recountedFt + " ft" : "—";
    }
    return "—";
  });
}

function rcMovementsSummary(item) {
  if (!item.movementIds || !item.movementIds.length) return "";
  return item.movementIds.map(function(mid) {
    var m = rcMovements.find(function(mv){ return mv.movementId === mid; });
    if (!m) return mid;
    var parts = [m.transactionNumber];
    if (m.system)          parts.push(m.system);
    if (m.transactionType) parts.push(m.transactionType);
    if (m.qtyMoved != null) parts.push("qty:" + m.qtyMoved);
    if (m.date)            parts.push(m.date);
    if (m.correctlyAccounted && m.correctlyAccounted !== "unknown") parts.push("accounted:" + m.correctlyAccounted);
    return parts.join(" | ");
  }).join("\n");
}

function rcResolutionLabel(val) {
  var map = {
    confirmed_correct: "Confirmed Correct",
    adjusted_up:       "Adjusted Up",
    adjusted_down:     "Adjusted Down",
    product_movement:  "Product Movement",
    unable_to_locate:  "Unable to Locate"
  };
  return map[val] || val || "";
}

function rcAutoColWidths(headers, rows) {
  return headers.map(function(h, i) {
    var max = h.length;
    rows.forEach(function(r) {
      var cell = r[i] == null ? "" : String(r[i]);
      // For multi-line cells use the longest line
      cell.split("\n").forEach(function(line){ if (line.length > max) max = line.length; });
    });
    return { wch: Math.min(max + 2, 60) };
  });
}

function rcExportXlsx(recountId) {
  var session = rcSessions.find(function(s){ return s.recountId === recountId; });
  if (!session) { alert("Recount session not found."); return; }

  var chain = rcBuildChain(session);
  var chainNames = chain.map(function(n){ return n.sessionName + (n.closedAt ? " (" + n.closedAt.slice(0,10) + ")" : ""); });

  var wb = XLSX.utils.book_new();

  // ── SERIALIZED SHEET ─────────────────────────────────────────────────
  (function() {
    var baseHeaders = ["Item #","Description","Serial / FSAN","Location","Gap Type",
                       "NISC Expected Qty","Recount Serials","Resolution","Movements"];
    var histHeaders = chainNames.map(function(n){ return "History: " + n; });
    var headers = baseHeaders.concat(histHeaders);

    var rows = (session.items.serialized || []).map(function(item) {
      var recsStr = item.recountedSerials ? item.recountedSerials.join("\n") : "";
      var hist    = rcChainHistoryForItem(chain, item, "serialized");
      return [
        item.itemNumber   || "",
        item.description  || "",
        item.serial       || "",
        item.location     || "",
        item.gapType      || "",
        item.niscExpectedQty != null ? item.niscExpectedQty : "",
        recsStr,
        rcResolutionLabel(item.resolutionStatus),
        rcMovementsSummary(item)
      ].concat(hist);
    });

    var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    ws["!cols"] = rcAutoColWidths(headers, rows);
    XLSX.utils.book_append_sheet(wb, ws, "Serialized");
  })();

  // ── BULK SHEET ───────────────────────────────────────────────────────
  (function() {
    var baseHeaders = ["Item #","Description","Location","Gap Type",
                       "Odoo Qty","Counted Qty","NISC Expected Qty","Recount Qty","Variance","Resolution","Movements"];
    var histHeaders = chainNames.map(function(n){ return "History: " + n; });
    var headers = baseHeaders.concat(histHeaders);

    var rows = (session.items.bulk || []).map(function(item) {
      var recQty  = item.recountedQty != null ? item.recountedQty : null;
      var baseQty = item.odooQty      != null ? item.odooQty      : null;
      var variance = (recQty != null && baseQty != null) ? (recQty - baseQty) : "";
      var hist = rcChainHistoryForItem(chain, item, "bulk");
      return [
        item.itemNumber    || "",
        item.description   || "",
        item.location      || "",
        item.gapType       || "",
        item.odooQty    != null ? item.odooQty    : "",
        item.countedQty != null ? item.countedQty : "",
        item.niscExpectedQty != null ? item.niscExpectedQty : "",
        recQty != null ? recQty : "",
        variance,
        rcResolutionLabel(item.resolutionStatus),
        rcMovementsSummary(item)
      ].concat(hist);
    });

    var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    ws["!cols"] = rcAutoColWidths(headers, rows);
    XLSX.utils.book_append_sheet(wb, ws, "Bulk");
  })();

  // ── REELS SHEET ──────────────────────────────────────────────────────
  (function() {
    var baseHeaders = ["Reel #","Item #","Description","Location","Gap Type",
                       "Odoo Ft","Counted Ft","NISC Expected Ft","Recount Inner","Recount Outer","Recount Ft","Variance","Resolution","Movements"];
    var histHeaders = chainNames.map(function(n){ return "History: " + n; });
    var headers = baseHeaders.concat(histHeaders);

    var rows = (session.items.reels || []).map(function(item) {
      var recFt   = item.recountedFt != null ? item.recountedFt : null;
      var baseOdoo = item.odooFt    != null ? item.odooFt    : null;
      var variance = (recFt != null && baseOdoo != null) ? (recFt - baseOdoo) : "";
      var hist = rcChainHistoryForItem(chain, item, "reels");
      return [
        item.reelNumber    || "",
        item.itemNumber    || "",
        item.description   || "",
        item.location      || "",
        item.gapType       || "",
        item.odooFt     != null ? item.odooFt     : "",
        item.countedFt  != null ? item.countedFt  : "",
        item.niscExpectedQty != null ? item.niscExpectedQty : "",
        item.innerSeqA  != null ? item.innerSeqA  : "",
        item.outerSeqA  != null ? item.outerSeqA  : "",
        recFt != null ? recFt : "",
        variance,
        rcResolutionLabel(item.resolutionStatus),
        rcMovementsSummary(item)
      ].concat(hist);
    });

    var ws = XLSX.utils.aoa_to_sheet([headers].concat(rows));
    ws["!cols"] = rcAutoColWidths(headers, rows);
    XLSX.utils.book_append_sheet(wb, ws, "Reels");
  })();

  var safeName = (session.recountName || recountId).replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
  XLSX.writeFile(wb, "recount-" + safeName + "-" + new Date().toISOString().slice(0,10) + ".xlsx");
}

// ═══════════════════════════════════════════════════════════════════════
// SESSION FINALIZE
// ═══════════════════════════════════════════════════════════════════════

function invFinalizeSession() {
  if (!invSession) return;
  var activeCount = invEvents.filter(function(e) { return e.status !== "voided"; }).length;
  if (!confirm(
    "Finalize session \"" + invSession.sessionName + "\"?\n\n" +
    "This will:\n" +
    "  1. Mark the session as closed\n" +
    "  2. Merge " + activeCount + " active event(s) into the master JSON\n" +
    "  3. Download an updated master JSON automatically\n\n" +
    "Replace your existing master JSON file with the downloaded one.\n\n" +
    "Note: Load the master JSON first (Receiving tab Step 1) so existing history is preserved.\n\nContinue?"
  )) return;

  var now = invNow();
  invSession.status    = "closed";
  invSession.closedAt  = now;
  invSession.updatedAt = now;

  appData.inventory_sessions = appData.inventory_sessions || [];
  var existingIdx = appData.inventory_sessions.findIndex(function(s) {
    return s.sessionId === invSession.sessionId;
  });
  var sessionRecord = Object.assign({}, invSession);
  if (existingIdx >= 0) {
    appData.inventory_sessions[existingIdx] = sessionRecord;
  } else {
    appData.inventory_sessions.push(sessionRecord);
  }

  appData.inventory_events = (appData.inventory_events || []).filter(function(e) {
    return e.sessionId !== invSession.sessionId;
  });
  appData.inventory_events = appData.inventory_events.concat(
    invEvents.map(function(e) { return Object.assign({}, e, { sessionId: invSession.sessionId }); })
  );

  appData.product_map = PRODUCT_MAP;
  appData.history = history;
  downloadText("Calix_Odoo_Converter_source_data.json", JSON.stringify(buildExportPayload(), null, 2), "application/json");

  var finalizeBtn = $("invFinalizeBtn");
  if (finalizeBtn) finalizeBtn.disabled = true;
  renderInvSessionMeta();
  alert("Session finalized and merged into master JSON.\nReplace your existing master file with the downloaded copy.");
}

// Restore sidebar + tab state (runs after all variables are declared)
try {
  if (localStorage.getItem("tim_sidebar_collapsed") === "1") {
    var _sb = document.getElementById("appSidebar");
    if (_sb) _sb.classList.add("collapsed");
  }
  var _savedTab = localStorage.getItem("tim_active_tab");
  if (_savedTab && ["receiving","inventory","products","mapping","barcodes"].includes(_savedTab)) {
    switchTab(_savedTab);
  }
} catch(e) {}

timLoadMasterCache();
timInitUsername();
renderInvSessionUI();
invAutoRestoreSession();
invLoadOdooQuantMap();
invLoadQuantsBaseline();
invLoadLocationMap();

// Keep AudioContext alive on every user gesture — browsers can re-suspend idle contexts
(function() {
  function _unlock() { timUnlockAudio(); }
  document.addEventListener("pointerdown", _unlock, { passive: true });
  document.addEventListener("keydown", _unlock, { passive: true });
})();


// ===================================================================
// BARCODE ASSIGNMENT TAB
// ===================================================================

const BC_STORAGE_KEY = "tim_barcode_map_v1";
const BC_BATCH_DRAFT_KEY = "tim_bc_batch_draft_v1";
var bcBatch = [];
var bcPendingBarcode = null;

function bcLoadBarcodeMap() {
  TimDB.get(BC_STORAGE_KEY).then(function(saved) {
    if (saved && typeof saved === "object") {
      Object.assign(BARCODE_MAP, saved);
      appData.barcode_map = BARCODE_MAP;
    }
  }).catch(function(){});
}

function bcSaveBarcodeMapToStorage() {
  TimDB.set(BC_STORAGE_KEY, BARCODE_MAP).catch(function(){});
}

function bcSaveBatchDraft() {
  TimDB.set(BC_BATCH_DRAFT_KEY, bcBatch).catch(function(){});
}

function bcLoadBatchDraft() {
  TimDB.get(BC_BATCH_DRAFT_KEY).then(function(saved) {
    if (Array.isArray(saved) && saved.length) {
      bcBatch = saved;
      bcRenderBatch();
    }
  }).catch(function(){});
}

function bcShowFeedback(type, msg) {
  var el = $("bcScanFeedback");
  if (!el) return;
  var bg   = { ok:"#dcfce7", warn:"#fef9c3", error:"#fee2e2", info:"#e0f2fe" };
  var text = { ok:"#166534", warn:"#78350f", error:"#991b1b", info:"#0c4a6e" };
  el.style.display = "block";
  el.style.background = bg[type] || "#f1f5f9";
  el.style.color = text[type] || "#374151";
  el.textContent = msg;
}

function bcProcessBarcodeScan() {
  var inp = $("bcScanInput");
  var raw = (inp ? inp.value : "").trim();
  if (!raw) return;
  if (inp) inp.value = "";
  timUnlockAudio();

  var bcKey = normKey(raw);

  // Already in the current batch (not yet committed to DB)
  var batchEntry = bcBatch.find(function(r) { return normKey(r.barcode) === bcKey; });
  if (batchEntry) {
    bcShowFeedback("ok", "Already in batch: " + batchEntry.itemNumber + (batchEntry.description && batchEntry.description !== batchEntry.itemNumber ? " — " + batchEntry.description : ""));
    timBeep("ok");
    if (inp) inp.focus();
    return;
  }

  // Known barcode — committed to DB
  var existingItem = BARCODE_MAP[bcKey];
  if (existingItem) {
    var pm = findProductMapMatch(existingItem);
    var desc = pm ? (getMapDescription(pm.entry) || existingItem) : existingItem;
    bcShowFeedback("ok", "Known: " + existingItem + (desc && desc !== existingItem ? " — " + desc : "") + " (logged, excluded from export)");
    bcAddToBatch(raw, existingItem, desc, true);
    timBeep("ok");
    if (inp) inp.focus();
    return;
  }

  // Scanned an item number instead of a barcode
  var productMatch = findProductMapMatch(raw);
  if (productMatch) {
    var hctc = productMatch.entry.hctc || productMatch.key;
    bcShowFeedback("warn", "That looks like item number " + hctc + ", not a barcode. Scan the product barcode instead.");
    timBeep("warn");
    if (inp) inp.focus();
    return;
  }

  // Unknown barcode — prompt for item number
  bcPendingBarcode = raw;
  $("bcPendingBarcodeDisplay").textContent = raw;
  var sec = $("bcUnknownSection");
  if (sec) sec.classList.remove("hidden");
  var itemInp = $("bcItemScanInput");
  if (itemInp) { itemInp.value = ""; itemInp.focus(); }
  bcShowFeedback("info", "Unknown barcode. Scan the item number to link it, or Cancel to skip.");
  timBeep("warn");
}

function bcProcessItemNumber() {
  var inp = $("bcItemScanInput");
  var raw = (inp ? inp.value : "").trim();
  if (!raw) return;

  var productMatch = findProductMapMatch(raw);
  if (!productMatch) {
    bcShowFeedback("error", '"' + raw + '" not found in product catalog. Try again.');
    if (inp) { inp.value = ""; inp.focus(); }
    timBeep("error");
    return;
  }

  var itemNumber = productMatch.entry.hctc || productMatch.key;
  var desc = getMapDescription(productMatch.entry) || itemNumber;

  bcAddToBatch(bcPendingBarcode, itemNumber, desc);
  bcShowFeedback("ok", 'Linked "' + bcPendingBarcode + '" → ' + itemNumber + (desc && desc !== itemNumber ? " (" + desc + ")" : ""));
  timBeep("ok");

  bcPendingBarcode = null;
  var sec = $("bcUnknownSection");
  if (sec) sec.classList.add("hidden");
  if (inp) inp.value = "";
  var scanInp = $("bcScanInput");
  if (scanInp) { scanInp.value = ""; scanInp.focus(); }
}

function bcCancelUnknown() {
  bcPendingBarcode = null;
  var sec = $("bcUnknownSection");
  if (sec) sec.classList.add("hidden");
  bcShowFeedback("info", "Cancelled. Ready for next barcode scan.");
  var scanInp = $("bcScanInput");
  if (scanInp) { scanInp.value = ""; scanInp.focus(); }
}

function bcAddToBatch(barcode, itemNumber, description, alreadyKnown) {
  var bcKey = normKey(barcode);
  var existing = bcBatch.find(function(r) { return normKey(r.barcode) === bcKey; });
  if (existing) {
    existing.itemNumber = itemNumber;
    existing.description = description;
    existing.timestamp = new Date().toISOString();
    if (alreadyKnown !== undefined) existing.alreadyKnown = !!alreadyKnown;
  } else {
    bcBatch.push({ barcode: barcode, itemNumber: itemNumber, description: description || "", timestamp: new Date().toISOString(), alreadyKnown: !!alreadyKnown });
  }
  bcRenderBatch();
}

function bcIncludeKnown(idx) {
  if (bcBatch[idx]) { bcBatch[idx].alreadyKnown = false; bcRenderBatch(); }
}

function bcRemoveFromBatch(idx) {
  bcBatch.splice(idx, 1);
  bcRenderBatch();
}

function bcRenderBatch() {
  bcSaveBatchDraft();
  var tbody = $("bcBatchBody");
  var countEl = $("bcBatchCount");
  if (countEl) countEl.textContent = bcBatch.length + (bcBatch.length === 1 ? " barcode" : " barcodes");
  if (!tbody) return;
  if (!bcBatch.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:24px;">No barcodes in batch. Scan a barcode to start.</td></tr>';
    return;
  }
  tbody.innerHTML = bcBatch.slice().reverse().map(function(r, i) {
    var origIdx = bcBatch.length - 1 - i;
    var known = r.alreadyKnown;
    var rowStyle = known ? ' style="opacity:0.55;"' : '';
    var knownBadge = known ? ' <span style="font-size:10px;background:#e2e8f0;color:#64748b;border-radius:3px;padding:1px 5px;vertical-align:middle;">known</span>' : '';
    var actionBtns = (known ? '<button class="secondary" style="padding:3px 10px;font-size:12px;margin:0 4px 0 0;" onclick="bcIncludeKnown(' + origIdx + ')">Include</button>' : '') +
      '<button class="danger" style="padding:3px 10px;font-size:12px;margin:0;" onclick="bcRemoveFromBatch(' + origIdx + ')">Remove</button>';
    return '<tr' + rowStyle + '>' +
      '<td style="font-family:monospace;font-size:13px;">' + escapeHtml(r.barcode) + '</td>' +
      '<td><strong>' + escapeHtml(r.itemNumber) + '</strong>' + knownBadge + '</td>' +
      '<td>' + escapeHtml(r.description || "") + '</td>' +
      '<td style="white-space:nowrap;color:#6b7280;font-size:12px;">' + new Date(r.timestamp).toLocaleTimeString() + '</td>' +
      '<td style="white-space:nowrap;">' + actionBtns + '</td>' +
      '</tr>';
  }).join("");
}

function bcClearBatch() {
  if (!bcBatch.length) return;
  if (!confirm("Clear all " + bcBatch.length + " item(s) from the current batch?")) return;
  bcBatch = [];
  bcRenderBatch();
  bcShowFeedback("info", "Batch cleared.");
  var scanInp = $("bcScanInput");
  if (scanInp) { scanInp.value = ""; scanInp.focus(); }
}

function bcExportAndSave() {
  if (!bcBatch.length) { alert("No barcodes in the current batch to export."); return; }

  var exportBatch = bcBatch.filter(function(r) { return !r.alreadyKnown; });
  var skippedCount = bcBatch.length - exportBatch.length;

  if (!exportBatch.length) {
    bcShowFeedback("warn", "All " + bcBatch.length + " barcode(s) are already known — nothing new to export. Use 'Include' on any row to force-add it.");
    timBeep("warn");
    return;
  }

  // Group by item number preserving insertion order
  var grouped = {};
  var itemOrder = [];
  exportBatch.forEach(function(r) {
    var k = normKey(r.itemNumber);
    if (!grouped[k]) { grouped[k] = []; itemOrder.push(k); }
    grouped[k].push(r);
  });

  var lines = [["id","default_code","name","template_multi_barcode_ids/name"].map(csvEscape).join(",")];
  itemOrder.forEach(function(k) {
    var items = grouped[k];
    var pm = findProductMapMatch(items[0].itemNumber);
    var odooId = pm && pm.entry ? (pm.entry.odoo_external_id || pm.entry.external_id || "") : "";
    var desc = items[0].description || (pm ? getMapDescription(pm.entry) : "");
    items.forEach(function(r, i) {
      lines.push([
        i === 0 ? odooId : "",
        i === 0 ? r.itemNumber : "",
        i === 0 ? desc : "",
        r.barcode
      ].map(csvEscape).join(","));
    });
  });

  var date = new Date().toISOString().slice(0, 10);
  downloadText("TIM_Barcodes_" + date + ".csv", lines.join("\n"), "text/csv");

  // Commit new barcodes to persistent BARCODE_MAP (already-known entries are already there)
  var count = exportBatch.length;
  exportBatch.forEach(function(r) { BARCODE_MAP[normKey(r.barcode)] = r.itemNumber; });
  appData.barcode_map = BARCODE_MAP;
  bcSaveBarcodeMapToStorage();

  bcBatch = [];
  bcRenderBatch();
  var msg = count + " barcode(s) saved to TIM’s database and exported to Odoo CSV.";
  if (skippedCount) msg += " " + skippedCount + " already-known barcode(s) were skipped.";
  bcShowFeedback("ok", msg);
  timBeep("ok");
}

// ── Odoo CSV import ──────────────────────────────────────────────────

function bcImportOdooCsv(file) {
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    try { bcProcessOdooImport(e.target.result, file.name); }
    catch(err) { alert("Import failed: " + err.message); }
  };
  reader.readAsText(file);
  // input removed from card; universal zone handles file selection
}

function bcProcessOdooImport(text, fileName) {
  var lines = text.split(/\r?\n/);
  var header = bcParseCsvRow(lines[0] || "");
  function colIdx(name) {
    return header.findIndex(function(h) { return h.trim().toLowerCase() === name.toLowerCase(); });
  }
  var idIdx      = colIdx("id");
  var codeIdx    = colIdx("default_code");
  var barcodeIdx = colIdx("template_multi_barcode_ids");

  if (barcodeIdx === -1) throw new Error("Column 'template_multi_barcode_ids' not found. Is this an Odoo Product Variant CSV?");
  if (codeIdx === -1)    throw new Error("Column 'default_code' not found.");

  var added = 0, updated = 0, unchanged = 0, conflicts = [];
  var currentCode = "", currentId = "";

  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var cells = bcParseCsvRow(line);
    var id      = (idIdx >= 0      ? cells[idIdx]      || "" : "").trim();
    var code    = (codeIdx >= 0    ? cells[codeIdx]    || "" : "").trim();
    var barcode = (barcodeIdx >= 0 ? cells[barcodeIdx] || "" : "").trim();

    if (code) { currentCode = code; currentId = id; }
    if (!barcode || !currentCode) continue;

    var bcKey    = normKey(barcode);
    var existing = BARCODE_MAP[bcKey];

    if (!existing) {
      BARCODE_MAP[bcKey] = currentCode; added++;
    } else if (normKey(existing) === normKey(currentCode)) {
      unchanged++;
    } else {
      conflicts.push({ barcode: barcode, was: existing, now: currentCode });
      BARCODE_MAP[bcKey] = currentCode; updated++;
    }

    // Backfill Odoo external ID into product_map if missing
    if (currentId) {
      var pm = findProductMapMatch(currentCode);
      if (pm && pm.entry && !pm.entry.odoo_external_id) pm.entry.odoo_external_id = currentId;
    }
  }

  appData.barcode_map = BARCODE_MAP;
  bcSaveBarcodeMapToStorage();

  var summary = added + " added, " + updated + " updated (Odoo wins), " + unchanged + " unchanged.";
  var detail = "";
  if (conflicts.length) {
    detail = "\n\nConflicts resolved (Odoo value used):\n" +
      conflicts.slice(0, 10).map(function(c) { return "  " + c.barcode + ": " + c.was + " → " + c.now; }).join("\n") +
      (conflicts.length > 10 ? "\n  …and " + (conflicts.length - 10) + " more" : "");
  }

  setDropState("bcImportZone", "bcImportStatus", true, "Loaded: " + fileName + " — " + (added + updated) + " barcode(s) updated");
  var res = $("bcImportResult");
  if (res) res.textContent = summary + (conflicts.length ? " " + conflicts.length + " conflict(s) resolved." : "");
  alert("Import complete: " + summary + detail);
}

function bcParseCsvRow(line) {
  var result = [], cur = "", inQ = false;
  for (var i = 0; i < line.length; i++) {
    var c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQ = true; }
      else if (c === ',') { result.push(cur); cur = ""; }
      else { cur += c; }
    }
  }
  result.push(cur);
  return result;
}

// Close location popover when clicking outside it
document.addEventListener("click", function(e) {
  var wrap = document.getElementById("invLocChipWrap");
  if (wrap && !wrap.contains(e.target)) invCloseLocPopover();
});

bcLoadBarcodeMap();
bcLoadBatchDraft();

// ── Catalog row helpers ────────────────────────────────────────────

function buildCatalogRowCells(key, map) {
  var trackingType = getTrackingType(map);
  var reelSuffix = trackingType === "reel" && map.reel_direction
    ? (map.reel_direction === "two_way" ? " 2-way" : " 1-way") : "";
  var trackingLabel = trackingType === "serial" ? "Serial" : trackingType === "reel" ? ("Reel" + reelSuffix) : "None";
  var pill = '<span class="tracking-pill ' + escapeHtml(trackingType) + '">' + trackingLabel + "</span>";
  var safeKey = key.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  var actions =
    '<button class="secondary" style="padding:3px 9px;font-size:12px;margin:0 3px 0 0;" ' +
      'onclick="prodEditProduct(\'' + safeKey + '\')">Edit</button>' +
    '<button class="secondary" style="padding:3px 9px;font-size:12px;margin:0;" ' +
      'onclick="prodShowItemHistory(\'' + safeKey + '\')">History</button>';
  return "<td>" + escapeHtml(key) + "</td>" +
    "<td>" + escapeHtml(map.hctc || "") + "</td>" +
    "<td>" + escapeHtml(map.name || map.description || "") + "</td>" +
    "<td>" + escapeHtml(map.vendor || "") + "</td>" +
    "<td>" + pill + "</td>" +
    "<td style='font-size:11px;word-break:break-all;'>" + escapeHtml(map.odoo_external_id || map.external_id || "") + "</td>" +
    "<td style='text-align:center;'>" + (map.requires_fsan ? "Yes" : "") + "</td>" +
    "<td style='text-align:center;'>" + (map.history_only ? "Yes" : "") + "</td>" +
    "<td style='white-space:nowrap;'>" + actions + "</td>";
}

function prodRenderOneRow(key) {
  var tbody = $("prodCatalogBody");
  if (!tbody) return;
  var map = PRODUCT_MAP[key];
  if (!map) return; // filtered out or deleted — no action needed
  var rows = tbody.getElementsByTagName("tr");
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].getAttribute("data-prodkey") === key) {
      rows[i].innerHTML = buildCatalogRowCells(key, map);
      return;
    }
  }
  // Row not currently visible (filtered) — no DOM work needed
}

var _prodSaveToastTimer = null;
function prodShowSaveToast(msg) {
  var toast = $("prodSaveToast");
  if (!toast) return;
  toast.textContent = msg || "✓ Saved";
  toast.classList.add("show");
  clearTimeout(_prodSaveToastTimer);
  _prodSaveToastTimer = setTimeout(function() { toast.classList.remove("show"); }, 1500);
}

// ── Zone clear buttons ─────────────────────────────────────────────

function updateClearBtns() {
  function show(id, condition) {
    var b = $(id);
    if (b) b.style.display = condition ? "" : "none";
  }
  var histLoaded = $("historyDropZone") && $("historyDropZone").classList.contains("loaded");
  var srcLoaded  = $("sourceDropZone")  && $("sourceDropZone").classList.contains("loaded");
  var bcLoaded   = $("bcImportZone")    && $("bcImportZone").classList.contains("loaded");
  show("clearMasterDataBtn",     histLoaded);
  show("clearSourceDataBtn",     srcLoaded);
  show("clearProductCatalogBtn", Object.keys(PRODUCT_MAP).length > 0);
  show("clearBarcodeImportBtn",  bcLoaded || Object.keys(BARCODE_MAP).length > 0);
}

function clearAllData() {
  if (!confirm("Clear ALL app data and start fresh?\n\nThis will permanently delete:\n• Active batch and receiving data\n• Inventory sessions\n• Master data (products, history, barcodes)\n• Your username\n\nThis cannot be undone.")) return;
  Promise.all([
    TimDB.remove(BATCH_DRAFT_KEY),
    TimDB.remove(INV_STORAGE_KEY),
    TimDB.remove(TIM_MASTER_CACHE_KEY),
    TimDB.remove(BC_STORAGE_KEY),
    TimDB.remove(BC_BATCH_DRAFT_KEY)
  ]).catch(function(){}).then(function() {
    try { localStorage.removeItem(TIM_USERNAME_KEY); } catch(e) {}
    try { localStorage.removeItem("tim_active_tab"); } catch(e) {}
    try { localStorage.removeItem("tim_sidebar_collapsed"); } catch(e) {}
    location.reload();
  });
}

function clearMasterData() {
  if (!confirm("Clear all master data (products, history, barcodes) from memory?\n\nExported files are not affected.")) return;
  Object.keys(PRODUCT_MAP).forEach(function(k) { delete PRODUCT_MAP[k]; });
  history.records = [];
  Object.keys(BARCODE_MAP).forEach(function(k) { delete BARCODE_MAP[k]; });
  appData.product_map = PRODUCT_MAP;
  appData.history = history;
  appData.barcode_map = BARCODE_MAP;
  TimDB.remove(TIM_MASTER_CACHE_KEY).catch(function(){});
  TimDB.remove(BC_STORAGE_KEY).catch(function(){});
  $("mapPreview").value = "{}";
  setDropState("historyDropZone", "historyDropStatus", false, "Waiting for upload");
  setDropState("bcImportZone", "bcImportStatus", false, "Waiting for upload");
  var hs = $("historyStatus"); if (hs) hs.textContent = "";
  var br = $("bcImportResult"); if (br) br.textContent = "";
  updateSidebarStatus(1, null);
  prodRenderList();
  if (lastLoadedRows.length) processRows(lastLoadedRows);
  else renderAll();
}

function clearSourceData() {
  if (!confirm("Clear the loaded source file and current batch?\n\nHistory is kept.")) return;
  lastLoadedRows = [];
  currentBatch = [];
  blindQueue = [];
  clearBatchDraft();
  var _sf = $("sourceFile"); if (_sf) _sf.value = "";
  setDropState("sourceDropZone", "sourceDropStatus", false, "Waiting for upload");
  updateSidebarStatus(2, null);
  renderAll();
  renderBlindQueue();
}

function clearProductCatalog() {
  var count = Object.keys(PRODUCT_MAP).length;
  if (!count) return;
  if (!confirm("Clear all " + count + " product(s) from the catalog?\n\nHistory records are kept. Exported files are not affected.")) return;
  Object.keys(PRODUCT_MAP).forEach(function(k) { delete PRODUCT_MAP[k]; });
  appData.product_map = PRODUCT_MAP;
  timSaveMasterCache();
  $("mapPreview").value = "{}";
  var statusEl = $("prodUploadStatus"); if (statusEl) statusEl.textContent = "";
  var banner = $("prodUploadSuccessBanner"); if (banner) banner.style.display = "none";
  prodRenderList();
  if (lastLoadedRows.length) processRows(lastLoadedRows);
  else renderAll();
}

function clearBarcodeImport() {
  var count = Object.keys(BARCODE_MAP).length;
  if (!confirm("Clear all " + count + " barcode mapping(s) from memory?\n\nExported files are not affected.")) return;
  Object.keys(BARCODE_MAP).forEach(function(k) { delete BARCODE_MAP[k]; });
  appData.barcode_map = BARCODE_MAP;
  TimDB.remove(BC_STORAGE_KEY).catch(function(){});
  setDropState("bcImportZone", "bcImportStatus", false, "Waiting for upload");
  var res = $("bcImportResult"); if (res) res.textContent = "";
}

// ── Product upload diff ────────────────────────────────────────────

var _prodPendingDiff = null;
var _PROD_DIFF_FIELDS = [
  { key: "name",             label: "Name" },
  { key: "vendor",           label: "Vendor" },
  { key: "tracking_type",    label: "Tracking" },
  { key: "reel_direction",   label: "Reel Direction" },
  { key: "odoo_external_id", label: "Odoo External ID" },
  { key: "hctc",             label: "NISC Item #" },
  { key: "requires_fsan",    label: "Requires FSAN" },
  { key: "history_only",     label: "History Only" }
];

function prodShowUploadDiff(diff) {
  _prodPendingDiff = diff;
  var parts = [];
  if (diff.added.length)   parts.push(diff.added.length + " new");
  if (diff.updated.length) parts.push(diff.updated.length + " updated");
  if (diff.unchanged)      parts.push(diff.unchanged + " unchanged");
  if (diff.skipped)        parts.push(diff.skipped + " skipped (blank key)");
  var sumEl = $("prodDiffSummary");
  if (sumEl) sumEl.textContent = parts.join(", ") + ".";

  var html = "";
  if (!diff.added.length && !diff.updated.length) {
    html = '<p style="text-align:center;color:#64748b;padding:32px 24px;">No changes detected — all rows already match the catalog.</p>';
  } else {
    if (diff.added.length) {
      html += '<span class="diff-section-label">' + diff.added.length + ' New Product' + (diff.added.length !== 1 ? 's' : '') + '</span>';
      html += '<table class="diff-table"><thead><tr><th>Key</th><th>Name</th><th>Vendor</th><th>Tracking</th><th>Odoo External ID</th></tr></thead><tbody>';
      diff.added.forEach(function(r) {
        var tt = r.entry.tracking_type || '';
        var rd = r.entry.reel_direction;
        var trackingDisplay = tt === 'reel' && rd ? tt + ' (' + (rd === 'two_way' ? '2-way' : '1-way') + ')' : tt;
        html += '<tr><td style="font-weight:600;color:#166534;">' + escapeHtml(r.key) +
          '</td><td>' + escapeHtml(r.entry.name || '') +
          '</td><td>' + escapeHtml(r.entry.vendor || '') +
          '</td><td>' + escapeHtml(trackingDisplay) +
          '</td><td style="font-size:11px;color:#64748b;">' + escapeHtml(r.entry.odoo_external_id || '') + '</td></tr>';
      });
      html += '</tbody></table>';
    }
    if (diff.updated.length) {
      html += '<span class="diff-section-label">' + diff.updated.length + ' Updated Product' + (diff.updated.length !== 1 ? 's' : '') + '</span>';
      html += '<table class="diff-table"><thead><tr><th>Key</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>';
      diff.updated.forEach(function(r) {
        r.changes.forEach(function(c, i) {
          html += '<tr>';
          if (i === 0) html += '<td rowspan="' + r.changes.length + '" style="font-weight:600;vertical-align:top;padding-top:9px;">' + escapeHtml(r.key) + '</td>';
          html += '<td style="color:#475569;">' + escapeHtml(c.field) + '</td>' +
            '<td><span class="diff-old-val">' + escapeHtml(String(c.old == null ? "" : c.old)) + '</span></td>' +
            '<td class="diff-new-val">' + escapeHtml(String(c.now == null ? "" : c.now)) + '</td></tr>';
        });
      });
      html += '</tbody></table>';
    }
  }

  var content = $("prodDiffContent");
  if (content) content.innerHTML = html;
  var modal = $("prodDiffModal");
  if (modal) modal.classList.remove("hidden");
}

function prodApplyUpload() {
  if (!_prodPendingDiff) return;
  var diff = _prodPendingDiff;
  diff.added.forEach(function(r)   { PRODUCT_MAP[r.key] = r.entry; });
  diff.updated.forEach(function(r) { PRODUCT_MAP[r.key] = r.entry; });
  appData.product_map = PRODUCT_MAP;
  $("mapPreview").value = JSON.stringify(PRODUCT_MAP, null, 2);
  prodRenderList();
  checkReelItemConflicts();
  var msg = "Done: " + diff.added.length + " added, " + diff.updated.length + " updated" +
    (diff.skipped ? ", " + diff.skipped + " skipped (blank key)" : "") + ". Click Export Master JSON to save.";
  var statusEl = $("prodUploadStatus"); if (statusEl) statusEl.textContent = msg;
  var banner = $("prodUploadSuccessBanner"); if (banner) banner.style.display = "flex";
  var modal = $("prodDiffModal"); if (modal) modal.classList.add("hidden");
  _prodPendingDiff = null;
  $("prodUploadFile").value = "";
  if (lastLoadedRows.length) processRows(lastLoadedRows);
}

function prodCancelUpload() {
  _prodPendingDiff = null;
  var modal = $("prodDiffModal"); if (modal) modal.classList.add("hidden");
  $("prodUploadFile").value = "";
  var statusEl = $("prodUploadStatus"); if (statusEl) statusEl.textContent = "Upload cancelled.";
}

// ── Product edit modal ─────────────────────────────────────────────

var _prodEditKey = null;

function prodEditProduct(key) {
  var entry = PRODUCT_MAP[key];
  if (!entry) return;
  _prodEditKey = key;
  $("prodEditKeyDisplay").textContent = "Key: " + key;
  $("prodEditHctc").value    = entry.hctc    || "";
  $("prodEditVendor").value  = entry.vendor  || "";
  $("prodEditName").value    = entry.name    || entry.description || "";
  $("prodEditTracking").value = entry.tracking_type || "serial";
  $("prodEditReelDir").value  = entry.reel_direction || (entry.tracking_type === "reel" ? "one_way" : "");
  $("prodEditOdooId").value   = entry.odoo_external_id || entry.external_id || "";
  $("prodEditFsan").checked    = !!entry.requires_fsan;
  $("prodEditHistOnly").checked = !!entry.history_only;
  // Reel IDs (read-only, show only when present)
  var reelIds = entry.reel_ids || "";
  var reelIdsWrap = $("prodEditReelIdsWrap");
  if (reelIds) {
    $("prodEditReelIds").value = reelIds;
    if (reelIdsWrap) reelIdsWrap.style.display = "";
  } else {
    if (reelIdsWrap) reelIdsWrap.style.display = "none";
  }
  prodEditTrackingChanged();
  $("prodEditModal").classList.remove("hidden");
}

function prodEditTrackingChanged() {
  var isReel = $("prodEditTracking") && $("prodEditTracking").value === "reel";
  var wrap = $("prodEditReelDirWrap");
  if (wrap) wrap.style.display = isReel ? "" : "none";
  // Default to one_way when switching to reel and no direction is set yet
  if (isReel && $("prodEditReelDir") && !$("prodEditReelDir").value) {
    $("prodEditReelDir").value = "one_way";
  }
}

function prodSaveEdit() {
  if (!_prodEditKey) return;
  var existing     = PRODUCT_MAP[_prodEditKey] || {};
  var trackingType = $("prodEditTracking").value;
  var externalId   = $("prodEditOdooId").value.trim();
  var nameVal      = $("prodEditName").value.trim();
  var reelDir      = trackingType === "reel" ? ($("prodEditReelDir").value || "one_way") : null;
  // Capture batch-critical fields before overwriting
  var prevTracking = existing.tracking_type;
  var prevHctc     = existing.hctc;
  // Merge: preserve any fields not surfaced in this form (e.g. reel_ids)
  PRODUCT_MAP[_prodEditKey] = Object.assign({}, existing, {
    hctc:             $("prodEditHctc").value.trim() || _prodEditKey,
    vendor:           $("prodEditVendor").value.trim(),
    name:             nameVal,
    description:      nameVal,
    tracking_type:    trackingType,
    serial_tracked:   trackingType === "serial",
    reel_direction:   reelDir,
    odoo_external_id: externalId || null,
    external_id:      externalId || null,
    requires_fsan:    $("prodEditFsan").checked,
    history_only:     $("prodEditHistOnly").checked
  });
  appData.product_map = PRODUCT_MAP;

  var savedKey = _prodEditKey;
  var newEntry = PRODUCT_MAP[savedKey];

  // Only reprocess the batch if fields that affect row validation actually changed
  var batchNeedsReprocess = lastLoadedRows.length > 0 &&
    (prevTracking !== newEntry.tracking_type || prevHctc !== newEntry.hctc);

  // Close modal and show feedback immediately
  $("prodEditModal").classList.add("hidden");
  _prodEditKey = null;
  prodShowSaveToast();

  // Patch just the one table row — no full re-render
  prodRenderOneRow(savedKey);

  // Defer only the storage write and optional batch reprocess
  setTimeout(function() {
    timSaveMasterCache();
    if (batchNeedsReprocess) processRows(lastLoadedRows);
  }, 0);
}

function prodCancelEdit() {
  _prodEditKey = null;
  $("prodEditModal").classList.add("hidden");
}

// ═══════════════════════════════════════════════════════════════════════
// CSV REEL IMPORT
// ═══════════════════════════════════════════════════════════════════════

var _csvImportPending = null;

function invImportReelsCsv(inputEl) {
  var file = (inputEl instanceof File) ? inputEl : inputEl.files[0];
  if (!file) return;
  if (!(inputEl instanceof File)) inputEl.value = "";
  var reader = new FileReader();
  reader.onload = function(e) {
    try {
      var rows = _parseReelCsv(e.target.result);
      // Skip header row if present
      if (rows.length && /sku|reel/i.test(rows[0][0])) rows = rows.slice(1);
      var parsed = _analyzeReelCsvRows(rows);
      _csvImportPending = parsed;
      _showCsvImportModal(parsed);
    } catch(err) {
      alert("Error parsing CSV: " + err.message);
    }
  };
  reader.readAsText(file);
}

function _parseReelCsv(text) {
  var rows = [], row = [], field = "", inQ = false;
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') { field += '"'; i++; }
        else { inQ = false; }
      } else {
        field += ch;
      }
    } else {
      if      (ch === '"') { inQ = true; }
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n') {
        row.push(field); field = "";
        if (row.some(function(f) { return f !== ""; })) rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some(function(f) { return f !== ""; })) rows.push(row);
  }
  return rows;
}

// columns: SKU(0), Reels No(1), Description(2), Inner Seq(3), Outer Seq(4), Qty(5), Last Updated(6), Notes(7)
function _analyzeReelCsvRows(rows) {
  var result = [];
  rows.forEach(function(cols) {
    if (cols.length < 2) return;
    var itemNum = normKey(cols[0] || "");
    var reelNum = normKey(cols[1] || "");
    if (!itemNum || !reelNum) return;

    var desc = (cols[2] || "").trim().replace(/^\[[^\]]+\]\s*/, "");
    var innerRaw = (cols[3] || "").trim();
    var outerRaw = (cols[4] || "").trim();
    var qty      = parseFloat((cols[5] || "").trim()) || 0;
    var dateRaw  = (cols[6] || "").trim();
    var notes    = (cols[7] || "").trim();

    var innerA = innerRaw !== "" ? parseFloat(innerRaw) : null;
    var outerA = outerRaw !== "" ? parseFloat(outerRaw) : null;
    var ftA    = (innerA !== null && outerA !== null) ? Math.abs(outerA - innerA) : qty;

    var mapEntry = PRODUCT_MAP[itemNum];
    var spanType = (mapEntry && mapEntry.reel_direction === "two_way") ? "two_way" : "single";

    var csvDate = null;
    if (dateRaw) {
      var d = new Date(dateRaw.replace(" ", "T"));
      if (!isNaN(d.getTime())) csvDate = d;
    }

    // Find most recent existing master event for this reel
    var k1 = normKey(itemNum), k2 = normKey(reelNum);
    var masterMatches = (appData.inventory_events || []).filter(function(e) {
      return e.eventType === "cable_reel_count" &&
             e.status    !== "voided"           &&
             normKey(e.itemNumber || "") === k1  &&
             normKey(e.reelNumber  || "") === k2;
    }).sort(function(a, b) {
      return (b.timestamp || "") > (a.timestamp || "") ? 1 : -1;
    });
    var existingEvent = masterMatches.length ? masterMatches[0] : null;

    // Skip reels already in the active session — don't interfere
    var hasActiveEvent = invEvents.some(function(e) {
      return e.eventType === "cable_reel_count" &&
             e.status    !== "voided"           &&
             normKey(e.itemNumber || "") === k1  &&
             normKey(e.reelNumber  || "") === k2;
    });

    var action;
    if (hasActiveEvent) {
      action = "skip_active";
    } else if (!existingEvent) {
      action = "add";
    } else {
      var existDate = new Date(existingEvent.timestamp);
      var existQty  = existingEvent.totalAvailableFt || existingEvent.qty || 0;
      if (csvDate && !isNaN(existDate.getTime())) {
        if      (csvDate > existDate) { action = "update"; }
        else if (csvDate < existDate) { action = "skip_older"; }
        else    { action = qty < existQty ? "update" : "skip_equal"; }
      } else {
        action = qty < existQty ? "update" : "skip_nodate";
      }
    }

    result.push({
      itemNum: itemNum, reelNum: reelNum, desc: desc,
      innerA: innerA, outerA: outerA, ftA: ftA,
      spanType: spanType, totalFt: qty, qty: qty,
      csvDate: csvDate, dateRaw: dateRaw, notes: notes,
      action: action, existingEvent: existingEvent
    });
  });
  return result;
}

function _showCsvImportModal(parsed) {
  var counts = {};
  parsed.forEach(function(r) { counts[r.action] = (counts[r.action] || 0) + 1; });
  var nAdd    = counts.add    || 0;
  var nUpdate = counts.update || 0;
  var nSkip   = (counts.skip_older || 0) + (counts.skip_equal || 0) + (counts.skip_nodate || 0);
  var nActive = counts.skip_active || 0;
  var nAction = nAdd + nUpdate;

  var html = '<div class="modal" style="max-width:440px;">'
    + '<div class="modal-header">'
    +   '<h2 style="margin:0;font-size:16px;">Import Reels from CSV</h2>'
    +   '<button onclick="invCancelCsvImport()" style="background:none;border:none;font-size:24px;color:#94a3b8;cursor:pointer;padding:0;line-height:1;">&times;</button>'
    + '</div>'
    + '<div class="modal-body" style="font-size:13px;">'
    +   '<p style="margin:0 0 14px;">Parsed <strong>' + parsed.length + '</strong> reels from CSV.</p>'
    +   '<div style="display:grid;grid-template-columns:1fr 1fr' + (nActive ? ' 1fr' : '') + ';gap:8px;margin-bottom:14px;">'
    +     _csvStatCard(nAdd,    "New",     "#f0fdf4","#86efac","#166534","#15803d")
    +     _csvStatCard(nUpdate, "Updates", "#fef9c3","#fde047","#854d0e","#92400e")
    +     _csvStatCard(nSkip,   "Skipped", "#f1f5f9","#cbd5e1","#475569","#334155")
    +     (nActive ? _csvStatCard(nActive, "Active Session","#fef2f2","#fca5a5","#991b1b","#991b1b") : "")
    +   '</div>';

  if (nSkip > 0) {
    html += '<p style="font-size:12px;color:#64748b;margin:0 0 8px;">'
          + nSkip + ' reel(s) skipped — existing records are more recent or have lower quantity.</p>';
  }
  if (nActive > 0) {
    html += '<p style="font-size:12px;color:#dc2626;margin:0 0 8px;">'
          + nActive + ' reel(s) skipped — already recorded in the active session.</p>';
  }

  if (nAction === 0) {
    html += '<p style="color:#dc2626;font-weight:600;margin:8px 0 0;">Nothing to import — all records are already up to date.</p>'
          + '</div>'
          + '<div style="padding:14px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;">'
          +   '<button class="secondary" onclick="invCancelCsvImport()">Close</button>'
          + '</div>';
  } else {
    html += '<p style="font-size:12px;color:#475569;margin:0;">Imports are written to master data. '
          + 'An updated master JSON will be downloaded — replace your Step 1 file after importing.</p>'
          + '</div>'
          + '<div style="padding:14px 18px;border-top:1px solid #e5e7eb;display:flex;gap:8px;justify-content:flex-end;">'
          +   '<button class="secondary" onclick="invCancelCsvImport()" style="margin:0;">Cancel</button>'
          +   '<button onclick="invConfirmCsvImport()" style="margin:0;background:#166534;color:#fff;border:none;border-radius:6px;padding:8px 18px;font-size:13px;font-weight:600;cursor:pointer;">'
          +     'Import ' + nAction + ' Reel' + (nAction !== 1 ? 's' : '')
          +   '</button>'
          + '</div>';
  }

  html += '</div>';
  var modal = $("invCsvImportModal");
  if (modal) { modal.innerHTML = html; modal.classList.remove("hidden"); }
}

function _csvStatCard(n, label, bg, border, labelColor, numColor) {
  return '<div style="background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;padding:8px 10px;">'
       +   '<div style="font-size:10px;color:' + labelColor + ';font-weight:700;text-transform:uppercase;letter-spacing:.05em;">' + label + '</div>'
       +   '<div style="font-size:22px;font-weight:700;color:' + numColor + ';">' + n + '</div>'
       + '</div>';
}

function invCancelCsvImport() {
  _csvImportPending = null;
  var modal = $("invCsvImportModal");
  if (modal) modal.classList.add("hidden");
}

function invConfirmCsvImport() {
  var parsed = _csvImportPending;
  if (!parsed) return;

  var toImport = parsed.filter(function(r) { return r.action === "add" || r.action === "update"; });
  if (!toImport.length) { invCancelCsvImport(); return; }

  var now       = invNow();
  var dateStr   = now.slice(0, 10);
  var sessionId = "csv_import_" + Date.now();

  var importSession = {
    sessionId:       sessionId,
    sessionName:     "Reel CSV Import " + dateStr,
    createdAt:       now,
    updatedAt:       now,
    closedAt:        now,
    status:          "closed",
    sequenceCounter: toImport.length
  };

  // Void superseded events for "update" rows
  toImport.filter(function(r) { return r.action === "update" && r.existingEvent; })
    .forEach(function(r) {
      var idx = appData.inventory_events.indexOf(r.existingEvent);
      if (idx >= 0) appData.inventory_events[idx].status = "voided";
    });

  // Build and push new events
  toImport.forEach(function(r, i) {
    var ts  = r.csvDate ? r.csvDate.toISOString() : now;
    var evt = {
      eventId:          invGenerateId("evt"),
      timestamp:        ts,
      sequence:         i + 1,
      eventType:        "cable_reel_count",
      status:           "active",
      sessionId:        sessionId,
      notes:            r.notes || "",
      messages:         [],
      scanType:         "reel_number",
      scannedValue:     r.reelNum,
      itemNumber:       r.itemNum,
      description:      r.desc,
      reelNumber:       r.reelNum,
      location:         "",
      spanType:         r.spanType,
      innerSeqA:        r.innerA,
      outerSeqA:        r.outerA,
      availableFtA:     r.ftA,
      totalAvailableFt: r.totalFt,
      qty:              r.totalFt
    };
    if (r.spanType === "two_way") {
      evt.innerSeqB    = null;
      evt.outerSeqB    = null;
      evt.availableFtB = 0;
    }
    appData.inventory_events.push(evt);
  });

  appData.inventory_sessions.push(importSession);

  invCancelCsvImport();

  downloadText(
    "Calix_Odoo_Converter_source_data.json",
    JSON.stringify(buildExportPayload(), null, 2),
    "application/json"
  );

  alert(
    "Import complete: " + toImport.length + " reel(s) imported.\n\n" +
    "The updated master JSON has been downloaded.\n" +
    "Replace your existing Step 1 file with it to make the import permanent."
  );
}

