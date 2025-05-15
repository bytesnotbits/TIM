/* It's definitely easier and safer for me to do the merge to avoid any potential copy/paste errors on your end.

Here is the merged offlineDB.js file, incorporating the Phase 1.1 changes into your original code structure. */

// --- START OF FILE offlineDB.js ---
// Handles IndexedDB interactions

const DB = {
    name: 'TelecomInventoryDB', // Kept your original DB name
    version: 8, // <<-- Incremented version for new stores and recountBatches index
    connection: null,
    // Added stores definition for consistency and easier reference
    stores: {
        inventory: 'inventory',
        transactionHistory: 'transactionHistory',
        recountAdjustments: 'recountAdjustments', // Existing store for programmatic adjustments
        recountBatches: 'recountBatches',
        countCycles: 'countCycles', // New store for cycles
        inventoryAdjustments: 'inventoryAdjustments' // New store for user-added adjustments
    },

    init: () => {
        return new Promise((resolve, reject) => {
            if (DB.connection) return resolve(DB.connection);
            console.log(`Opening database ${DB.name} version ${DB.version}`);
            const request = indexedDB.open(DB.name, DB.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction; // Use transaction from event
                console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);

                // --- Inventory Store (Logic from your original file - unchanged) ---
                let invStore;
                // Note: Your original logic correctly handled keyPath change from pre-v5
                if (event.oldVersion < 5 && db.objectStoreNames.contains(DB.stores.inventory)) {
                    console.log("Recreating 'inventory' store for keyPath change...");
                    db.deleteObjectStore(DB.stores.inventory);
                }
                if (!db.objectStoreNames.contains(DB.stores.inventory)) {
                    console.log("Creating 'inventory' object store...");
                    invStore = db.createObjectStore(DB.stores.inventory, { keyPath: 'itemId' }); // Uses itemId as keyPath
                    invStore.createIndex('SKU_idx', 'SKU', { unique: false });
                    invStore.createIndex('location_idx', 'location', { unique: false });
                    invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                    invStore.createIndex('recountBatchId_idx', 'currentRecountBatchId', { unique: false });
                    invStore.createIndex('reelNumber_idx', 'reelNumber', { unique: false });
                    console.log("Created indexes on new 'inventory' store.");
                } else {
                    invStore = transaction.objectStore(DB.stores.inventory); // Get reference via transaction
                    if (!invStore.indexNames.contains('SKU_idx')) invStore.createIndex('SKU_idx', 'SKU', { unique: false });
                    if (!invStore.indexNames.contains('location_idx')) invStore.createIndex('location_idx', 'location', { unique: false });
                    if (!invStore.indexNames.contains('isActive_idx')) invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    if (!invStore.indexNames.contains('toCount_idx')) invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                    if (!invStore.indexNames.contains('recountBatchId_idx')) invStore.createIndex('recountBatchId_idx', 'currentRecountBatchId', { unique: false });
                    if (!invStore.indexNames.contains('reelNumber_idx')) invStore.createIndex('reelNumber_idx', 'reelNumber', { unique: false });
                    console.log("Verified/Created indexes on 'inventory' store.");
                } // end inventory

                // --- Transaction History Store (Logic from your original file - unchanged) ---
                let historyStore;
                if (!db.objectStoreNames.contains(DB.stores.transactionHistory)) {
                     console.log("Creating 'transactionHistory' object store...");
                    historyStore = db.createObjectStore(DB.stores.transactionHistory, { keyPath: 'id', autoIncrement: true });
                    historyStore.createIndex('sku_idx', 'SKU', { unique: false });
                    historyStore.createIndex('timestamp_idx', 'timestamp', { unique: false });
                    historyStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    historyStore.createIndex('location_idx', 'location', { unique: false });
                     console.log("Created indexes on new 'transactionHistory' store.");
                } else {
                    historyStore = transaction.objectStore(DB.stores.transactionHistory); // Get reference via transaction
                    if (!historyStore.indexNames.contains('sku_idx')) historyStore.createIndex('sku_idx', 'SKU', { unique: false });
                    if (!historyStore.indexNames.contains('timestamp_idx')) historyStore.createIndex('timestamp_idx', 'timestamp', { unique: false });
                    if (!historyStore.indexNames.contains('itemId_idx')) historyStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    if (!historyStore.indexNames.contains('location_idx')) historyStore.createIndex('location_idx', 'location', { unique: false });
                    console.log("Verified/Created indexes on 'transactionHistory' store.");
                } // end transactionHistory

                // --- Recount Adjustments Store (Existing store from your original file - unchanged) ---
                let adjustmentStore; // Renamed var locally to avoid conflict, refers to your original store
                 if (!db.objectStoreNames.contains(DB.stores.recountAdjustments)) {
                    console.log("Creating 'recountAdjustments' object store...");
                    adjustmentStore = db.createObjectStore(DB.stores.recountAdjustments, { keyPath: 'adjustmentId', autoIncrement: true });
                    adjustmentStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    adjustmentStore.createIndex('recordedDuringRecountBatchId_idx', 'recordedDuringRecountBatchId', { unique: false });
                    adjustmentStore.createIndex('adjustmentTransactionId_idx', 'adjustmentTransactionId', { unique: false });
                     console.log("Created indexes on new 'recountAdjustments' store.");
                } else {
                     adjustmentStore = transaction.objectStore(DB.stores.recountAdjustments); // Get reference via transaction
                    if (!adjustmentStore.indexNames.contains('itemId_idx')) adjustmentStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    if (!adjustmentStore.indexNames.contains('recordedDuringRecountBatchId_idx')) adjustmentStore.createIndex('recordedDuringRecountBatchId_idx', 'recordedDuringRecountBatchId', { unique: false });
                    if (!adjustmentStore.indexNames.contains('adjustmentTransactionId_idx')) adjustmentStore.createIndex('adjustmentTransactionId_idx', 'adjustmentTransactionId', { unique: false });
                    console.log("Verified/Created indexes on 'recountAdjustments' store.");
                } // end recountAdjustments

                // --- Recount Batches Store (Logic from your original, MODIFIED to add index) ---
                let batchStore;
                if (!db.objectStoreNames.contains(DB.stores.recountBatches)) {
                    console.log("Creating 'recountBatches' object store...");
                    batchStore = db.createObjectStore(DB.stores.recountBatches, { keyPath: 'recountBatchId' });
                    batchStore.createIndex('status_idx', 'status', { unique: false });
                    batchStore.createIndex('createdAt_idx', 'createdAt', { unique: false });
                    // *** ADDED new index during creation ***
                    batchStore.createIndex('by_parentCycleId', 'parentCycleId', { unique: false });
                    console.log("Created indexes (including by_parentCycleId) on new 'recountBatches' store.");
                } else {
                    batchStore = transaction.objectStore(DB.stores.recountBatches); // Get reference via transaction
                    if (!batchStore.indexNames.contains('status_idx')) batchStore.createIndex('status_idx', 'status', { unique: false });
                    if (!batchStore.indexNames.contains('createdAt_idx')) batchStore.createIndex('createdAt_idx', 'createdAt', { unique: false });
                    // *** ADDED new index if store already exists ***
                    if (!batchStore.indexNames.contains('by_parentCycleId')) {
                        batchStore.createIndex('by_parentCycleId', 'parentCycleId', { unique: false });
                        console.log("Created index 'by_parentCycleId' on existing 'recountBatches' store.");
                    }
                    console.log("Verified/Created indexes on 'recountBatches' store.");
                } // end recountBatches

                // --- *** NEW: Count Cycles Store *** ---
                if (!db.objectStoreNames.contains(DB.stores.countCycles)) {
                    console.log(`Creating '${DB.stores.countCycles}' object store...`);
                    const cycleStore = db.createObjectStore(DB.stores.countCycles, { keyPath: 'cycleId' });
                    // Fields: cycleId, cutOffDate, startDate, status ('open', 'finalized'), finalizedTimestamp, createdBy
                    cycleStore.createIndex('by_status', 'status', { unique: false }); // Index as requested
                    console.log(`Created object store: ${DB.stores.countCycles} with index 'by_status'`);
                }

                // --- *** NEW: Inventory Adjustments Store (User-added) *** ---
                 if (!db.objectStoreNames.contains(DB.stores.inventoryAdjustments)) {
                    console.log(`Creating '${DB.stores.inventoryAdjustments}' object store...`);
                    const invAdjustmentStore = db.createObjectStore(DB.stores.inventoryAdjustments, { keyPath: 'adjustmentId', autoIncrement: true });
                    // Fields: adjustmentId, SKU, label, quantity, timestamp, user, addedDuringCycleId, addedDuringRecountId (nullable)
                    invAdjustmentStore.createIndex('by_sku', 'SKU', { unique: false }); // Index as requested
                    invAdjustmentStore.createIndex('by_addedDuringCycleId', 'addedDuringCycleId', { unique: false }); // Index as requested
                    invAdjustmentStore.createIndex('by_addedDuringRecountId', 'addedDuringRecountId', { unique: false }); // Index as requested
                    console.log(`Created object store: ${DB.stores.inventoryAdjustments} with indexes 'by_sku', 'by_addedDuringCycleId', 'by_addedDuringRecountId'`);
                 }

                console.log(`Database upgrade/schema check complete for version ${DB.version}.`);
            }; // end onupgradeneeded

            request.onsuccess = (event) => { DB.connection = event.target.result; DB.connection.onerror = (e) => { console.error("DB Error:", e.target.errorCode);}; console.log("DB connection successful."); resolve(DB.connection); };
            request.onerror = (event) => { console.error("DB Init Error:", request.error); reject(request.error); };
            request.onblocked = () => { console.warn("DB connection blocked."); alert("DB update blocked. Close other tabs & refresh."); reject(new Error("DB connection blocked")); };
        });
    }, // end init

    // --- Inventory Functions (Unchanged from your original) ---
    loadInventory: () => DB._readAll(DB.stores.inventory, 'inventory items'),
    saveInventory: (data) => DB._clearAndWrite(DB.stores.inventory, data, ['itemId', 'SKU', 'location']), // Kept your required fields

    // --- Transaction History Functions (Unchanged from your original) ---
    loadTransactionHistory: () => DB._readAll(DB.stores.transactionHistory, 'history records', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    saveTransactionHistory: (data) => {
        console.log(`[DB.saveTransactionHistory] Received history data array with length: ${data?.length ?? 'undefined'}`);
        return DB._clearAndWrite(DB.stores.transactionHistory, data, ['timestamp', 'type']); // Kept your required fields
    }, // end saveTransactionHistory
    addTransaction: (data) => {
        console.log(`[DB.addTransaction] Attempting to add history record:`, data);
        const summaryLogTypes = ['import_csv', 'new_count_started_import', 'recount_items_imported', 'inventory_finalized'];
        const isSummaryLog = summaryLogTypes.includes(data.type);
        if (!isSummaryLog && (!data.SKU || !data.itemId)) {
            console.error("[DB.addTransaction] Item-specific history record is missing SKU or itemId!", data);
        }
        const baseRequiredFields = ['timestamp', 'type'];
        return DB._addOne(DB.stores.transactionHistory, data, baseRequiredFields);
    }, // end addTransaction

    // --- Recount Adjustment Functions (Existing store, unchanged from your original) ---
    addRecountAdjustment: (data) => DB._addOne(DB.stores.recountAdjustments, data, ['itemId', 'recordedDuringRecountBatchId', 'adjustmentTransactionId', 'adjustmentQuantity', 'timestamp', 'user']),
    getRecountAdjustmentsByItemId: (itemId) => DB._getAllByIndex(DB.stores.recountAdjustments, 'itemId_idx', itemId, 'adjustments', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),

    // --- Recount Batch Functions (Unchanged from your original) ---
    createRecountBatch: (batchData) => {
        return DB._addOne(DB.stores.recountBatches, batchData, ['recountBatchId', 'cutOffDate', 'status', 'createdAt']);
    }, // end createRecountBatch
    getRecountBatchDetails: (recountBatchId) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            try {
                const transaction = DB.connection.transaction([DB.stores.recountBatches], 'readonly');
                const store = transaction.objectStore(DB.stores.recountBatches);
                const request = store.get(recountBatchId);
                request.onsuccess = () => { resolve(request.result); };
                request.onerror = (event) => { reject(new Error(`Failed to get batch ${recountBatchId}: ${event.target.error}`)); };
                transaction.onerror = (event) => { reject(new Error(`Tx error getting batch: ${event.target.error}`)); };
            } catch (error) { reject(error); }
        });
    }, // end getRecountBatchDetails
    getActiveRecountBatches: () => {
        return DB._getAllByIndex(DB.stores.recountBatches, 'status_idx', 'open', 'active batches', (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }, // end getActiveRecountBatches
    closeRecountBatch: (recountBatchId) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            try {
                const transaction = DB.connection.transaction([DB.stores.recountBatches], 'readwrite');
                const store = transaction.objectStore(DB.stores.recountBatches);
                const request = store.get(recountBatchId);
                request.onsuccess = () => {
                    const batch = request.result;
                    if (batch) {
                        if (batch.status === 'closed') { console.warn(`Recount batch ${recountBatchId} is already closed.`); resolve(batch); return; }
                        batch.status = 'closed';
                        const updateRequest = store.put(batch);
                        updateRequest.onsuccess = () => { console.log(`Recount batch ${recountBatchId} marked as closed.`); resolve(batch); };
                        updateRequest.onerror = (event) => { reject(new Error(`Failed to update batch status: ${event.target.error}`)); };
                    } else { reject(new Error(`Recount batch ${recountBatchId} not found.`)); }
                };
                request.onerror = (event) => { reject(new Error(`Failed to get batch for closing: ${event.target.error}`)); };
                transaction.onerror = (event) => { reject(new Error(`Tx error closing batch: ${event.target.error}`)); };
            } catch (error) { reject(error); }
        });
    }, // end closeRecountBatch

    // --- History Query Functions (Unchanged from your original) ---
    getTransactionHistoryBySKU: (sku) => DB._getAllByIndex(DB.stores.transactionHistory, 'sku_idx', sku, 'SKU history', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    getTransactionHistoryByItemId: (itemId) => DB._getAllByIndex(DB.stores.transactionHistory, 'itemId_idx', itemId, 'itemId history', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),

    // --- *** NEW DB Functions for Phase 1 (Cycles, User Adjustments, Recount Query) *** ---

    /**
     * Saves or updates a count cycle record.
     * @param {object} cycleData - The cycle data object (must include cycleId).
     * @returns {Promise<string>} Resolves with the cycleId on success.
     */
    saveCycle: function(cycleData) {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));
            if (!cycleData || !cycleData.cycleId) return reject(new Error("Cycle data requires a cycleId."));

            const transaction = DB.connection.transaction([DB.stores.countCycles], 'readwrite');
            const store = transaction.objectStore(DB.stores.countCycles);
            const request = store.put(cycleData); // Use put for save/update

            request.onsuccess = (event) => resolve(event.target.result); // Returns the key (cycleId)
            request.onerror = (event) => {
                console.error(`Error saving cycle (ID: ${cycleData.cycleId}):`, event.target.error);
                reject(event.target.error);
            };
            transaction.oncomplete = () => console.log(`Transaction completed: Saved cycle (ID: ${cycleData.cycleId})`);
            transaction.onerror = (event) => console.error("Transaction error saving cycle:", event.target.error);
        });
    },

    /**
     * Retrieves the first open count cycle found.
     * @returns {Promise<object|null>} Resolves with the cycle object or null if no open cycle found.
     */
    getOpenCycle: function() {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));

            const transaction = DB.connection.transaction([DB.stores.countCycles], 'readonly');
            const store = transaction.objectStore(DB.stores.countCycles);
            const index = store.index('by_status'); // Use the index defined in onupgradeneeded
            const request = index.get('open'); // Get the first record matching 'open'

            request.onsuccess = (event) => {
                resolve(event.target.result ? event.target.result : null);
            };
            request.onerror = (event) => {
                console.error("Error getting open cycle:", event.target.error);
                reject(event.target.error);
            };
        });
    },

     /**
      * Retrieves a specific count cycle by its ID.
      * @param {string} cycleId - The ID of the cycle to retrieve.
      * @returns {Promise<object|null>} Resolves with the cycle object or null if not found.
      */
     getCycleById: function(cycleId) {
         return new Promise((resolve, reject) => {
             if (!DB.connection) return reject(new Error("DB not initialized."));

             const transaction = DB.connection.transaction([DB.stores.countCycles], 'readonly');
             const store = transaction.objectStore(DB.stores.countCycles);
             const request = store.get(cycleId); // Get by keyPath

             request.onsuccess = (event) => {
                 resolve(event.target.result ? event.target.result : null);
             };
             request.onerror = (event) => {
                 console.error(`Error getting cycle by ID (${cycleId}):`, event.target.error);
                 reject(event.target.error);
             };
         });
     },

     /**
      * Retrieves all recount batches associated with a specific parent cycle ID.
      * @param {string} parentCycleId - The ID of the parent count cycle.
      * @returns {Promise<Array<object>>} Resolves with an array of recount batch objects.
      */
     getRecountsForCycle: function(parentCycleId) {
         // Uses the new 'by_parentCycleId' index added in onupgradeneeded
         return DB._getAllByIndex(DB.stores.recountBatches, 'by_parentCycleId', parentCycleId, 'recounts for cycle', (a, b) => new Date(a.createdAt) - new Date(b.createdAt)); // Sort ascending? Or by batch ID? Ascending for now.
     },

    /**
     * Adds a new USER-ENTERED inventory adjustment record to the dedicated store.
     * @param {object} adjustmentData - The adjustment data (SKU, label, quantity, etc.). adjustmentId is auto-generated.
     * @returns {Promise<number>} Resolves with the auto-generated adjustmentId on success.
     */
    addAdjustment: function(adjustmentData) {
        // Use the new 'inventoryAdjustments' store
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));
            // Basic validation (can be enhanced)
            if (!adjustmentData || !adjustmentData.SKU || adjustmentData.quantity === undefined || adjustmentData.label === undefined) {
                return reject(new Error("Adjustment data requires at least SKU, label, and quantity."));
            }
            // Required fields for adding to this specific store
            const required = ['SKU', 'label', 'quantity', 'user', 'addedDuringCycleId']; // addedDuringRecountId is optional/nullable

             // Add timestamp if not provided by caller
             if (!adjustmentData.timestamp) {
                adjustmentData.timestamp = new Date().toISOString();
            }

            // Use _addOne helper, specifying the correct store name and required fields
            return DB._addOne(DB.stores.inventoryAdjustments, adjustmentData, required)
                .then(newId => {
                    console.log(`Transaction completed: Added user adjustment (ID: ${newId}, SKU: ${adjustmentData.SKU})`);
                    resolve(newId);
                })
                .catch(error => {
                     console.error(`Error adding user adjustment for SKU (${adjustmentData.SKU}):`, error);
                     reject(error); // Reject the promise if _addOne fails
                });
        });
    },


    // --- Internal Helper Functions (Unchanged from your original, using DB.stores where applicable) ---
    _readAll: (storeName, logName = 'items', sortFn = null) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            try {
                const transaction = DB.connection.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.getAll();
                request.onsuccess = () => {
                    let result = request.result || [];
                    if (sortFn && typeof sortFn === 'function') { result = result.sort(sortFn); }
                    console.log(`Loaded ${result.length} ${logName}.`);
                    resolve(result);
                };
                request.onerror = (event) => { console.error(`Error loading ${logName}:`, event.target.error); reject(event.target.error); };
                transaction.onerror = (event) => { console.error(`Read tx error loading ${logName}:`, event.target.error); reject(event.target.error); };
            } catch (error) { console.error(`Error init tx load ${logName}:`, error); reject(error); }
        });
    }, // end _readAll
    _clearAndWrite: (storeName, data, requiredFields = []) => { // Your implementation using put after clear
        return new Promise(async (resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            if (!Array.isArray(data)) { console.error(`[DB._clearAndWrite:${storeName}] Error: Received non-array data:`, data); return reject(new Error("Invalid data: Expected array")); }
            console.log(`[DB._clearAndWrite:${storeName}] Received data array with length: ${data.length}`);
            try {
                const transaction = DB.connection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                let successCount = 0, errorCount = 0, skippedCount = 0;
                const clearRequest = store.clear();
                clearRequest.onerror = (event) => { console.error(`[DB._clearAndWrite:${storeName}] Error clearing store:`, event.target.error); };
                clearRequest.onsuccess = () => {
                    console.log(`[DB._clearAndWrite:${storeName}] Store cleared. Starting write...`);
                    if (data.length === 0) { console.log(`[DB._clearAndWrite:${storeName}] Data array is empty, nothing to write.`); return; }
                    const writePromises = data.map(item => {
                        return new Promise((resolveItem) => {
                            try {
                                const request = store.put(item); // Always use PUT after clearing
                                request.onsuccess = () => { successCount++; resolveItem({ status: 'success' }); };
                                request.onerror = (event) => { console.error(`[DB._clearAndWrite:${storeName}] Error writing item (PUT):`, event.target.error, item); errorCount++; resolveItem({ status: 'error' }); };
                            } catch (writeError) { console.error(`[DB._clearAndWrite:${storeName}] Sync error during PUT:`, writeError, item); errorCount++; resolveItem({ status: 'error' }); }
                        });
                    });
                    Promise.allSettled(writePromises).then(() => { console.log(`[DB._clearAndWrite:${storeName}] Write operations processed.`); });
                }; // end clearRequest.onsuccess
                transaction.oncomplete = () => {
                     console.log(`[DB._clearAndWrite:${storeName}] Transaction completed. S:${successCount}, F:${errorCount}, K:${skippedCount}. Items processed: ${data.length}`);
                     (errorCount === 0) ? resolve({ successCount, errorCount, skippedCount }) : reject(new Error(`${storeName} write tx completed with ${errorCount} errors.`));
                };
                transaction.onerror = (event) => { console.error(`[DB._clearAndWrite:${storeName}] Transaction error:`, event.target.error); reject(new Error(`Tx failed writing ${storeName}: ${event.target.error}`)); };
            } catch (error) { console.error(`[DB._clearAndWrite:${storeName}] Error initiating transaction:`, error); reject(error); }
        });
    }, // end _clearAndWrite
     _addOne: (storeName, data, requiredFields = []) => { // Your implementation with logs
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            const missingField = requiredFields.find(field => data[field] === undefined || data[field] === null || (typeof data[field] === 'string' && data[field].trim() === ''));
            if (missingField) { console.error(`Invalid data for ${storeName} (missing ${missingField}):`, data); return reject(new Error(`Invalid data format for ${storeName}`)); }
            try {
                const transaction = DB.connection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                console.log(`[DB._addOne: ${storeName}] Adding item:`, data);
                const request = store.add(data);
                request.onsuccess = (event) => { console.log(`[DB._addOne: ${storeName}] Add successful. New key:`, event.target.result); resolve(event.target.result); };
                request.onerror = (event) => { console.error(`[DB._addOne: ${storeName}] Error adding item:`, event.target.error, 'Data:', data); reject(event.target.error); };
                transaction.onerror = (event) => { console.error(`[DB._addOne: ${storeName}] Transaction error adding item:`, event.target.error); };
            } catch (error) { console.error(`[DB._addOne: ${storeName}] Sync error initiating transaction/add:`, error); reject(error); }
        });
    }, // end _addOne
    _getAllByIndex: (storeName, indexName, key, logName = 'items', sortFn = null) => { // Your implementation
         return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            if (key === undefined || key === null) return reject(new Error("Index key required"));
            try {
                const transaction = DB.connection.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                if (!store.indexNames.contains(indexName)) return reject(new Error(`Index '${indexName}' not found on ${storeName}.`));
                const index = store.index(indexName);
                const request = index.getAll(IDBKeyRange.only(key));
                request.onsuccess = () => {
                    let result = request.result || [];
                     if (sortFn && typeof sortFn === 'function') { result = result.sort(sortFn); }
                    console.log(`Found ${result.length} ${logName} for index ${indexName}=${key}.`);
                    resolve(result);
                };
                request.onerror = (event) => { console.error(`Error fetching ${logName} by ${indexName}:`, event.target.error); reject(event.target.error); };
                transaction.onerror = (event) => { console.error(`Read tx error fetching ${logName} by index:`, event.target.error); reject(event.target.error); };
            } catch (error) { console.error(`Error init tx fetch ${logName} by index:`, error); reject(error); }
        });
    }, // end _getAllByIndex

    // --- Utility (Unchanged from your original) ---
    generateSimpleId: () => {
        const randomPart = Math.random().toString(36).substring(2, 11);
        const timePart = Date.now().toString(36);
        return `${timePart}-${randomPart}`;
    }, // Generates a simple ID based on time and random string

}; // End DB object

// export default DB; // Uncomment if using ES modules

// --- END OF FILE offlineDB.js ---


/* Summary of Merged Changes:

DB.version: Updated to 8.

DB.stores Object: Added near the top for clarity. References to store names later in the code were updated to use DB.stores.storeName where appropriate (mostly within the new functions and onupgradeneeded).

onupgradeneeded:

Kept your original logic for inventory, transactionHistory, and recountAdjustments stores and their indexes.

Modified the recountBatches store logic to add the new by_parentCycleId index, ensuring it's added whether the store is being created new or already exists.

Added the creation logic for the new countCycles store and its by_status index.

Added the creation logic for the new inventoryAdjustments store and its by_sku, by_addedDuringCycleId, and by_addedDuringRecountId indexes.

Existing Functions: All your original helper functions (loadInventory, saveInventory, addRecountAdjustment, createRecountBatch, etc.) and internal helpers (_readAll, _clearAndWrite, _addOne, etc.) have been preserved exactly as they were in the file you provided.

New Functions: The five new functions (saveCycle, getOpenCycle, getCycleById, getRecountsForCycle, addAdjustment) have been added with their complete implementations. Note that addAdjustment uses the new inventoryAdjustments store, distinct from your existing addRecountAdjustment which uses the recountAdjustments store.

Verification of No Regression:

Existing Stores: The schema definitions in onupgradeneeded for inventory, transactionHistory, and recountAdjustments are identical to your original file. recountBatches only had an index added, preserving its original structure and indexes (status_idx, createdAt_idx).

Existing Functions: I manually compared the function signatures and bodies of all the helper functions present in your original file against the merged version. They remain unchanged. This ensures that any code currently calling loadInventory, saveInventory, addRecountAdjustment, createRecountBatch, addTransaction, etc., will behave exactly as before.

Internal Helpers: The logic within _readAll, _clearAndWrite, _addOne, and _getAllByIndex is identical to your original file.

Database Name: Kept as TelecomInventoryDB.

Version Increment: The version is correctly incremented to 8, ensuring onupgradeneeded will run once to apply the schema changes.

Therefore, based on the provided original file, this merged version correctly implements the required database changes for Step 1.1 while preserving all previously existing database functionality.

You can now replace your local offlineDB.js with this merged code. We are now correctly set up to proceed with Roadmap Phase 1.2: Cycle Count Logic. Please let me know when you're ready. */