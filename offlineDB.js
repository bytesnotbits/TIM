// --- START OF FILE offlineDB.js ---
// Increment the database version to trigger onupgradeneeded.

const DB = {
    name: 'TelecomInventoryDB',
    version: 7, // <<-- Incremented version for recountBatches store
    connection: null,

    init: () => {
        return new Promise((resolve, reject) => {
            if (DB.connection) return resolve(DB.connection);
            console.log(`Opening database ${DB.name} version ${DB.version}`);
            const request = indexedDB.open(DB.name, DB.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;
                console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);

                // --- Inventory Store ---
                let invStore;
                if (event.oldVersion < 5 && db.objectStoreNames.contains('inventory')) {
                    console.log("Recreating 'inventory' store for keyPath change...");
                    db.deleteObjectStore('inventory');
                }
                if (!db.objectStoreNames.contains('inventory')) {
                    console.log("Creating 'inventory' object store...");
                    invStore = db.createObjectStore('inventory', { keyPath: 'itemId' });
                    // Create indexes immediately
                    invStore.createIndex('SKU_idx', 'SKU', { unique: false });
                    invStore.createIndex('location_idx', 'location', { unique: false });
                    invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                    invStore.createIndex('recountBatchId_idx', 'currentRecountBatchId', { unique: false });
                    invStore.createIndex('reelNumber_idx', 'reelNumber', { unique: false });
                    console.log("Created indexes on new 'inventory' store.");
                } else {
                    invStore = transaction.objectStore('inventory');
                    // Verify/Add indexes if upgrading from v5 or v6
                    if (!invStore.indexNames.contains('SKU_idx')) invStore.createIndex('SKU_idx', 'SKU', { unique: false });
                    if (!invStore.indexNames.contains('location_idx')) invStore.createIndex('location_idx', 'location', { unique: false });
                    if (!invStore.indexNames.contains('isActive_idx')) invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    if (!invStore.indexNames.contains('toCount_idx')) invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                    if (!invStore.indexNames.contains('recountBatchId_idx')) invStore.createIndex('recountBatchId_idx', 'currentRecountBatchId', { unique: false });
                    if (!invStore.indexNames.contains('reelNumber_idx')) invStore.createIndex('reelNumber_idx', 'reelNumber', { unique: false });
                    console.log("Verified/Created indexes on 'inventory' store.");
                }

                // --- Transaction History Store ---
                let historyStore;
                if (!db.objectStoreNames.contains('transactionHistory')) {
                     console.log("Creating 'transactionHistory' object store...");
                    historyStore = db.createObjectStore('transactionHistory', { keyPath: 'id', autoIncrement: true });
                    historyStore.createIndex('sku_idx', 'SKU', { unique: false });
                    historyStore.createIndex('timestamp_idx', 'timestamp', { unique: false });
                    historyStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    historyStore.createIndex('location_idx', 'location', { unique: false });
                     console.log("Created indexes on new 'transactionHistory' store.");
                } else {
                    historyStore = transaction.objectStore('transactionHistory');
                    if (!historyStore.indexNames.contains('sku_idx')) historyStore.createIndex('sku_idx', 'SKU', { unique: false });
                    if (!historyStore.indexNames.contains('timestamp_idx')) historyStore.createIndex('timestamp_idx', 'timestamp', { unique: false });
                    if (!historyStore.indexNames.contains('itemId_idx')) historyStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    if (!historyStore.indexNames.contains('location_idx')) historyStore.createIndex('location_idx', 'location', { unique: false });
                    console.log("Verified/Created indexes on 'transactionHistory' store.");
                }

                // --- Recount Adjustments Store ---
                let adjustmentStore;
                 if (!db.objectStoreNames.contains('recountAdjustments')) {
                    console.log("Creating 'recountAdjustments' object store...");
                    adjustmentStore = db.createObjectStore('recountAdjustments', { keyPath: 'adjustmentId', autoIncrement: true });
                    adjustmentStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    adjustmentStore.createIndex('recordedDuringRecountBatchId_idx', 'recordedDuringRecountBatchId', { unique: false });
                    adjustmentStore.createIndex('adjustmentTransactionId_idx', 'adjustmentTransactionId', { unique: false });
                     console.log("Created indexes on new 'recountAdjustments' store.");
                } else {
                     adjustmentStore = transaction.objectStore('recountAdjustments');
                    if (!adjustmentStore.indexNames.contains('itemId_idx')) adjustmentStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    if (!adjustmentStore.indexNames.contains('recordedDuringRecountBatchId_idx')) adjustmentStore.createIndex('recordedDuringRecountBatchId_idx', 'recordedDuringRecountBatchId', { unique: false });
                    if (!adjustmentStore.indexNames.contains('adjustmentTransactionId_idx')) adjustmentStore.createIndex('adjustmentTransactionId_idx', 'adjustmentTransactionId', { unique: false });
                    console.log("Verified/Created indexes on 'recountAdjustments' store.");
                }

                // --- ** NEW: Recount Batches Store ** ---
                let batchStore;
                if (!db.objectStoreNames.contains('recountBatches')) {
                    console.log("Creating 'recountBatches' object store...");
                    // Use recountBatchId itself as the key, it should be unique
                    batchStore = db.createObjectStore('recountBatches', { keyPath: 'recountBatchId' });
                    // Add indexes
                    batchStore.createIndex('status_idx', 'status', { unique: false }); // To find 'open' batches
                    batchStore.createIndex('createdAt_idx', 'createdAt', { unique: false }); // For sorting
                    console.log("Created indexes on new 'recountBatches' store.");
                } else {
                    batchStore = transaction.objectStore('recountBatches');
                    if (!batchStore.indexNames.contains('status_idx')) batchStore.createIndex('status_idx', 'status', { unique: false });
                    if (!batchStore.indexNames.contains('createdAt_idx')) batchStore.createIndex('createdAt_idx', 'createdAt', { unique: false });
                    console.log("Verified/Created indexes on 'recountBatches' store.");
                }


                console.log("Database upgrade/schema check complete for version 7.");
            }; // end onupgradeneeded

            request.onsuccess = (event) => { DB.connection = event.target.result; DB.connection.onerror = (e) => { console.error("DB Error:", e.target.errorCode);}; console.log("DB connection successful."); resolve(DB.connection); };
            request.onerror = (event) => { console.error("DB Init Error:", request.error); reject(request.error); };
            request.onblocked = () => { console.warn("DB connection blocked."); alert("DB update blocked. Close other tabs & refresh."); reject(new Error("DB connection blocked")); };
        });
    }, // end init

    // --- Inventory Functions (Unchanged from v5/v6) ---
    loadInventory: () => DB._readAll('inventory', 'inventory items'),
    saveInventory: (data) => DB._clearAndWrite('inventory', data, ['itemId', 'SKU', 'location']),

    // --- Transaction History Functions (Unchanged from v5/v6) ---
    loadTransactionHistory: () => DB._readAll('transactionHistory', 'history records', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    saveTransactionHistory: (data) => DB._clearAndWrite('transactionHistory', data, ['timestamp', 'type'], true), // Use add=true
    addTransaction: (data) => DB._addOne('transactionHistory', data, ['timestamp', 'type']),

    // --- Recount Adjustment Functions (Unchanged from v6) ---
    addRecountAdjustment: (data) => DB._addOne('recountAdjustments', data, ['itemId', 'recordedDuringRecountBatchId', 'adjustmentTransactionId', 'adjustmentQuantity', 'timestamp', 'user']),
    getRecountAdjustmentsByItemId: (itemId) => DB._getAllByIndex('recountAdjustments', 'itemId_idx', itemId, 'adjustments', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),

    // --- ** NEW: Recount Batch Functions ** ---
    createRecountBatch: (batchData) => {
        // batchData = { recountBatchId: '...', cutOffDate: '...', status: 'open', createdAt: '...' }
        return DB._addOne('recountBatches', batchData, ['recountBatchId', 'cutOffDate', 'status', 'createdAt']);
    },

    getRecountBatchDetails: (recountBatchId) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            try {
                const transaction = DB.connection.transaction(['recountBatches'], 'readonly');
                const store = transaction.objectStore('recountBatches');
                const request = store.get(recountBatchId); // Get by key

                request.onsuccess = () => {
                    resolve(request.result); // Returns the batch object or undefined
                };
                request.onerror = (event) => { reject(new Error(`Failed to get batch ${recountBatchId}: ${event.target.error}`)); };
                transaction.onerror = (event) => { reject(new Error(`Tx error getting batch: ${event.target.error}`)); };
            } catch (error) { reject(error); }
        });
    },

    getActiveRecountBatches: () => {
        // Returns array of open batch objects, sorted by creation date descending
        return DB._getAllByIndex('recountBatches', 'status_idx', 'open', 'active batches', (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    closeRecountBatch: (recountBatchId) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            try {
                const transaction = DB.connection.transaction(['recountBatches'], 'readwrite');
                const store = transaction.objectStore('recountBatches');
                const request = store.get(recountBatchId);

                request.onsuccess = () => {
                    const batch = request.result;
                    if (batch) {
                        if (batch.status === 'closed') {
                            console.warn(`Recount batch ${recountBatchId} is already closed.`);
                            resolve(batch); // Already closed, resolve successfully
                            return;
                        }
                        batch.status = 'closed';
                        const updateRequest = store.put(batch);
                        updateRequest.onsuccess = () => { console.log(`Recount batch ${recountBatchId} marked as closed.`); resolve(batch); };
                        updateRequest.onerror = (event) => { reject(new Error(`Failed to update batch status: ${event.target.error}`)); };
                    } else {
                        reject(new Error(`Recount batch ${recountBatchId} not found.`));
                    }
                };
                request.onerror = (event) => { reject(new Error(`Failed to get batch for closing: ${event.target.error}`)); };
                transaction.oncomplete = () => { /* console.log('Close batch tx complete'); */ };
                transaction.onerror = (event) => { reject(new Error(`Tx error closing batch: ${event.target.error}`)); };
            } catch (error) { reject(error); }
        });
    },

    // --- History Query Functions (Unchanged from v5/v6) ---
    getTransactionHistoryBySKU: (sku) => DB._getAllByIndex('transactionHistory', 'sku_idx', sku, 'SKU history', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    getTransactionHistoryByItemId: (itemId) => DB._getAllByIndex('transactionHistory', 'itemId_idx', itemId, 'itemId history', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),


    // --- Internal Helper Functions ---
    _readAll: (storeName, logName = 'items', sortFn = null) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            try {
                const transaction = DB.connection.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => {
                    let result = request.result || [];
                    if (sortFn && typeof sortFn === 'function') {
                        result = result.sort(sortFn);
                    }
                    console.log(`Loaded ${result.length} ${logName}.`);
                    resolve(result);
                };
                request.onerror = (event) => { console.error(`Error loading ${logName}:`, event.target.error); reject(event.target.error); };
                transaction.onerror = (event) => { console.error(`Read tx error loading ${logName}:`, event.target.error); reject(event.target.error); };
            } catch (error) { console.error(`Error init tx load ${logName}:`, error); reject(error); }
        });
    },

    _clearAndWrite: (storeName, data, requiredFields = [], useAdd = false) => {
        return new Promise(async (resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            if (!Array.isArray(data)) return reject(new Error("Invalid data: Expected array"));
            try {
                const transaction = DB.connection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                let successCount = 0, errorCount = 0, skippedCount = 0;
                const clearRequest = store.clear();

                clearRequest.onerror = (event) => { console.error(`Error clearing ${storeName} store:`, event.target.error); /* Tx will abort */ };
                clearRequest.onsuccess = () => {
                    console.log(`${storeName} store cleared. Starting write...`);
                    const writePromises = data.map(item => {
                        return new Promise((resolveItem) => {
                            const missingField = requiredFields.find(field => item[field] === undefined || item[field] === null || String(item[field]).trim() === '');
                            if (missingField) {
                                console.warn(`Skipping invalid item in ${storeName} (missing ${missingField}):`, item);
                                skippedCount++; resolveItem({ status: 'skipped' }); return;
                            }
                            try {
                                const request = useAdd ? store.add(item) : store.put(item);
                                request.onsuccess = () => { successCount++; resolveItem({ status: 'success' }); };
                                request.onerror = (event) => { console.error(`Error writing item to ${storeName}:`, event.target.error, item); errorCount++; resolveItem({ status: 'error' }); };
                            } catch (writeError) { console.error(`Sync error writing item to ${storeName}:`, writeError, item); errorCount++; resolveItem({ status: 'error' }); }
                        });
                    });
                    Promise.allSettled(writePromises).then(() => { console.log(`${storeName} write attempt processed.`); });
                };
                transaction.oncomplete = () => { console.log(`${storeName} write tx completed. S:${successCount},F:${errorCount},K:${skippedCount}`); (errorCount === 0) ? resolve({ successCount, errorCount, skippedCount }) : reject(new Error(`${storeName} write tx completed with ${errorCount} errors.`)); };
                transaction.onerror = (event) => { console.error(`Tx error writing ${storeName}:`, event.target.error); reject(new Error(`Tx failed writing ${storeName}: ${event.target.error}`)); };
            } catch (error) { console.error(`Error init tx write ${storeName}:`, error); reject(error); }
        });
    },

     _addOne: (storeName, data, requiredFields = []) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            const missingField = requiredFields.find(field => data[field] === undefined || data[field] === null || (typeof data[field] === 'string' && data[field].trim() === ''));
            if (missingField) {
                 console.error(`Invalid data for ${storeName} (missing ${missingField}):`, data);
                 return reject(new Error(`Invalid data format for ${storeName}`));
            }
            try {
                const transaction = DB.connection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.add(data);
                request.onsuccess = (event) => { resolve(event.target.result); }; // Result is the new key
                request.onerror = (event) => { console.error(`Error adding to ${storeName}:`, event.target.error, data); reject(event.target.error); };
                transaction.onerror = (event) => { console.error(`Tx error adding to ${storeName}:`, event.target.error); /* Request should catch */ };
            } catch (error) { console.error(`Error init tx add to ${storeName}:`, error); reject(error); }
        });
    },

    _getAllByIndex: (storeName, indexName, key, logName = 'items', sortFn = null) => {
         return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            if (key === undefined || key === null) return reject(new Error("Index key required"));
            try {
                const transaction = DB.connection.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                if (!store.indexNames.contains(indexName)) return reject(new Error(`Index '${indexName}' not found on ${storeName}.`));
                const index = store.index(indexName);
                const request = index.getAll(IDBKeyRange.only(key)); // Use key range for exact match

                request.onsuccess = () => {
                    let result = request.result || [];
                     if (sortFn && typeof sortFn === 'function') {
                        result = result.sort(sortFn);
                    }
                    console.log(`Found ${result.length} ${logName} for index ${indexName}=${key}.`);
                    resolve(result);
                };
                request.onerror = (event) => { console.error(`Error fetching ${logName} by ${indexName}:`, event.target.error); reject(event.target.error); };
                transaction.onerror = (event) => { console.error(`Read tx error fetching ${logName} by index:`, event.target.error); reject(event.target.error); };
            } catch (error) { console.error(`Error init tx fetch ${logName} by index:`, error); reject(error); }
        });
    },

    // --- Utility ---
    generateSimpleId: () => {
        const randomPart = Math.random().toString(36).substring(2, 11);
        const timePart = Date.now().toString(36);
        return `${timePart}-${randomPart}`;
    },

    addTransaction: (data) => {
        console.log(`[DB.addTransaction] Attempting to add history record:`, data); // <-- ADD THIS LOG
        // Ensure required fields (SKU, itemId, etc.) are present in 'data' here
        if (!data.SKU || !data.itemId) {
             console.error("[DB.addTransaction] History record is missing SKU or itemId!", data);
             // Optionally reject the promise here if these are critical
        }
        return DB._addOne('transactionHistory', data, ['timestamp', 'type', 'itemId', 'SKU']); // Ensure SKU and itemId are required here
    },
    
    _addOne: (storeName, data, requiredFields = []) => {
        return new Promise((resolve, reject) => {
            // ... (initial checks) ...
            try {
                const transaction = DB.connection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                console.log(`[DB._addOne: ${storeName}] Adding item:`, data); // <-- ADD LOG
                const request = store.add(data);
    
                request.onsuccess = (event) => {
                    console.log(`[DB._addOne: ${storeName}] Add successful. New key:`, event.target.result); // <-- ADD LOG
                    resolve(event.target.result); // Result is the new key
                };
                request.onerror = (event) => {
                    console.error(`[DB._addOne: ${storeName}] Error adding item:`, event.target.error, 'Data:', data); // <-- Enhanced LOG
                    reject(event.target.error);
                };
                transaction.onerror = (event) => {
                     console.error(`[DB._addOne: ${storeName}] Transaction error adding item:`, event.target.error); // <-- ADD LOG
                     /* Request should catch */
                };
            } catch (error) {
                console.error(`[DB._addOne: ${storeName}] Sync error initiating transaction/add:`, error); // <-- ADD LOG
                reject(error);
            }
        });
    },
};

// --- END OF FILE offlineDB.js ---