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

                // --- Inventory Store ---
                let invStore;
                if (event.oldVersion < 5 && db.objectStoreNames.contains(DB.stores.inventory)) {
                    console.log("Recreating 'inventory' store for keyPath change from SKU to itemId...");
                    db.deleteObjectStore(DB.stores.inventory);
                }
                if (!db.objectStoreNames.contains(DB.stores.inventory)) {
                    console.log("Creating 'inventory' object store with keyPath: 'itemId'...");
                    invStore = db.createObjectStore(DB.stores.inventory, { keyPath: 'itemId' });
                    invStore.createIndex('SKU_idx', 'SKU', { unique: false });
                    invStore.createIndex('location_idx', 'location', { unique: false });
                    invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                    invStore.createIndex('recountBatchId_idx', 'currentRecountBatchId', { unique: false });
                    invStore.createIndex('reelNumber_idx', 'reelNumber', { unique: false });
                    console.log("Created indexes on new 'inventory' store.");
                } else {
                    invStore = transaction.objectStore(DB.stores.inventory);
                    if (invStore.keyPath !== 'itemId') { // Should not happen if oldVersion < 5 was handled
                        console.error("CRITICAL: Inventory store exists but keyPath is not itemId. This should have been handled by store recreation.");
                        // This state is problematic. Forcing recreation if this somehow occurs.
                        db.deleteObjectStore(DB.stores.inventory);
                        invStore = db.createObjectStore(DB.stores.inventory, { keyPath: 'itemId' });
                        console.log("Re-created 'inventory' object store due to incorrect keyPath.");
                    }
                    if (!invStore.indexNames.contains('SKU_idx')) invStore.createIndex('SKU_idx', 'SKU', { unique: false });
                    if (!invStore.indexNames.contains('location_idx')) invStore.createIndex('location_idx', 'location', { unique: false });
                    if (!invStore.indexNames.contains('isActive_idx')) invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    if (!invStore.indexNames.contains('toCount_idx')) invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                    if (!invStore.indexNames.contains('recountBatchId_idx')) invStore.createIndex('recountBatchId_idx', 'currentRecountBatchId', { unique: false });
                    if (!invStore.indexNames.contains('reelNumber_idx')) invStore.createIndex('reelNumber_idx', 'reelNumber', { unique: false });
                    console.log("Verified/Created indexes on 'inventory' store.");
                }

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
                }

                // --- Recount Adjustments Store (Existing store from your original file - unchanged) ---
                let adjustmentStore; 
                 if (!db.objectStoreNames.contains(DB.stores.recountAdjustments)) {
                    console.log("Creating 'recountAdjustments' object store...");
                    adjustmentStore = db.createObjectStore(DB.stores.recountAdjustments, { keyPath: 'adjustmentId', autoIncrement: true });
                    adjustmentStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    adjustmentStore.createIndex('recordedDuringRecountBatchId_idx', 'recordedDuringRecountBatchId', { unique: false });
                    adjustmentStore.createIndex('adjustmentTransactionId_idx', 'adjustmentTransactionId', { unique: false });
                     console.log("Created indexes on new 'recountAdjustments' store.");
                } else {
                     adjustmentStore = transaction.objectStore(DB.stores.recountAdjustments); 
                    if (!adjustmentStore.indexNames.contains('itemId_idx')) adjustmentStore.createIndex('itemId_idx', 'itemId', { unique: false });
                    if (!adjustmentStore.indexNames.contains('recordedDuringRecountBatchId_idx')) adjustmentStore.createIndex('recordedDuringRecountBatchId_idx', 'recordedDuringRecountBatchId', { unique: false });
                    if (!adjustmentStore.indexNames.contains('adjustmentTransactionId_idx')) adjustmentStore.createIndex('adjustmentTransactionId_idx', 'adjustmentTransactionId', { unique: false });
                    console.log("Verified/Created indexes on 'recountAdjustments' store.");
                } 

                // --- Recount Batches Store (Logic from your original, MODIFIED to add index) ---
                let batchStore;
                if (!db.objectStoreNames.contains(DB.stores.recountBatches)) {
                    console.log("Creating 'recountBatches' object store...");
                    batchStore = db.createObjectStore(DB.stores.recountBatches, { keyPath: 'recountBatchId' });
                    batchStore.createIndex('status_idx', 'status', { unique: false });
                    batchStore.createIndex('createdAt_idx', 'createdAt', { unique: false });
                    batchStore.createIndex('by_parentCycleId', 'parentCycleId', { unique: false });
                    console.log("Created indexes (including by_parentCycleId) on new 'recountBatches' store.");
                } else {
                    batchStore = transaction.objectStore(DB.stores.recountBatches); 
                    if (!batchStore.indexNames.contains('status_idx')) batchStore.createIndex('status_idx', 'status', { unique: false });
                    if (!batchStore.indexNames.contains('createdAt_idx')) batchStore.createIndex('createdAt_idx', 'createdAt', { unique: false });
                    if (!batchStore.indexNames.contains('by_parentCycleId')) {
                        batchStore.createIndex('by_parentCycleId', 'parentCycleId', { unique: false });
                        console.log("Created index 'by_parentCycleId' on existing 'recountBatches' store.");
                    }
                    console.log("Verified/Created indexes on 'recountBatches' store.");
                } 

                // --- Count Cycles Store ---
                if (!db.objectStoreNames.contains(DB.stores.countCycles)) {
                    console.log(`Creating '${DB.stores.countCycles}' object store...`);
                    const cycleStore = db.createObjectStore(DB.stores.countCycles, { keyPath: 'cycleId' });
                    cycleStore.createIndex('by_status', 'status', { unique: false }); 
                    console.log(`Created object store: ${DB.stores.countCycles} with index 'by_status'`);
                }

                // --- Inventory Adjustments Store (User-added) ---
                 if (!db.objectStoreNames.contains(DB.stores.inventoryAdjustments)) {
                    console.log(`Creating '${DB.stores.inventoryAdjustments}' object store...`);
                    const invAdjustmentStore = db.createObjectStore(DB.stores.inventoryAdjustments, { keyPath: 'adjustmentId', autoIncrement: true });
                    invAdjustmentStore.createIndex('by_sku', 'SKU', { unique: false }); 
                    invAdjustmentStore.createIndex('by_addedDuringCycleId', 'addedDuringCycleId', { unique: false }); 
                    invAdjustmentStore.createIndex('by_addedDuringRecountId', 'addedDuringRecountId', { unique: false }); 
                    console.log(`Created object store: ${DB.stores.inventoryAdjustments} with indexes 'by_sku', 'by_addedDuringCycleId', 'by_addedDuringRecountId'`);
                 }

                console.log(`Database upgrade/schema check complete for version ${DB.version}.`);
            }; 

            request.onsuccess = (event) => { DB.connection = event.target.result; DB.connection.onerror = (e) => { console.error("DB Error:", e.target.errorCode);}; console.log("DB connection successful."); resolve(DB.connection); };
            request.onerror = (event) => { console.error("DB Init Error:", request.error); reject(request.error); };
            request.onblocked = () => { console.warn("DB connection blocked."); alert("DB update blocked. Close other tabs & refresh."); reject(new Error("DB connection blocked")); };
        });
    }, 

    // --- Inventory Functions ---
    loadInventory: () => DB._readAll(DB.stores.inventory, 'inventory items'),
    saveInventory: (data) => DB._clearAndWrite(DB.stores.inventory, data, ['itemId', 'SKU', 'location']), 

    // --- Transaction History Functions ---
    loadTransactionHistory: () => DB._readAll(DB.stores.transactionHistory, 'history records', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    saveTransactionHistory: (data) => {
        console.log(`[DB.saveTransactionHistory] Received history data array with length: ${data?.length ?? 'undefined'}`);
        return DB._clearAndWrite(DB.stores.transactionHistory, data, ['timestamp', 'type']); 
    }, 
    addTransaction: (data) => {
        console.log(`[DB.addTransaction] Attempting to add history record:`, data);
        const summaryLogTypes = ['import_csv', 'new_count_started_import', 'recount_items_imported', 'inventory_finalized'];
        const isSummaryLog = summaryLogTypes.includes(data.type);
        if (!isSummaryLog && (!data.SKU || !data.itemId)) {
            console.error("[DB.addTransaction] Item-specific history record is missing SKU or itemId!", data);
        }
        const baseRequiredFields = ['timestamp', 'type'];
        return DB._addOne(DB.stores.transactionHistory, data, baseRequiredFields);
    }, 

    // --- Recount Adjustment Functions ---
    addRecountAdjustment: (data) => DB._addOne(DB.stores.recountAdjustments, data, ['itemId', 'recordedDuringRecountBatchId', 'adjustmentTransactionId', 'adjustmentQuantity', 'timestamp', 'user']),
    getRecountAdjustmentsByItemId: (itemId) => DB._getAllByIndex(DB.stores.recountAdjustments, 'itemId_idx', itemId, 'adjustments', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),

    // --- Recount Batch Functions ---
    createRecountBatch: (batchData) => {
        return DB._addOne(DB.stores.recountBatches, batchData, ['recountBatchId', 'cutOffDate', 'status', 'createdAt']);
    }, 
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
    }, 
    getActiveRecountBatches: () => {
        return DB._getAllByIndex(DB.stores.recountBatches, 'status_idx', 'open', 'active batches', (a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }, 
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
    }, 

    // --- History Query Functions ---
    getTransactionHistoryBySKU: (sku) => DB._getAllByIndex(DB.stores.transactionHistory, 'sku_idx', sku, 'SKU history', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
    getTransactionHistoryByItemId: (itemId) => DB._getAllByIndex(DB.stores.transactionHistory, 'itemId_idx', itemId, 'itemId history', (a, b) => new Date(b.timestamp) - new Date(a.timestamp)),

    // --- NEW Search Functions for itemId Refactor ---
    /**
     * Finds all inventory items matching a given SKU.
     * @param {string} sku - The SKU to search for.
     * @returns {Promise<Array<object>>} A promise that resolves with an array of matching items.
     */
    findItemsBySku: (sku) => {
        return DB._getAllByIndex(DB.stores.inventory, 'SKU_idx', sku, `items for SKU ${sku}`);
    },

    /**
     * Finds a specific inventory item by SKU and Reel Number.
     * Assumes SKU + Reel Number is a unique combination for reels.
     * @param {string} sku - The SKU of the reel.
     * @param {string} reelNumber - The Reel Number of the reel.
     * @returns {Promise<object|null>} A promise that resolves with the matching item or null if not found.
     */
    findItemBySkuAndReelNumber: (sku, reelNumber) => {
        return new Promise(async (resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));
            if (!sku || !reelNumber) return reject(new Error("SKU and ReelNumber are required."));

            try {
                const transaction = DB.connection.transaction([DB.stores.inventory], 'readonly');
                const store = transaction.objectStore(DB.stores.inventory);
                const skuIndex = store.index('SKU_idx');
                const request = skuIndex.getAll(IDBKeyRange.only(sku));

                request.onsuccess = () => {
                    const itemsWithSku = request.result || [];
                    const foundItem = itemsWithSku.find(item => item.isReel && item.reelNumber === reelNumber);
                    resolve(foundItem || null);
                };
                request.onerror = (event) => {
                    console.error(`Error finding item by SKU ${sku} and Reel ${reelNumber}:`, event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                console.error("Error initiating findItemBySkuAndReelNumber:", error);
                reject(error);
            }
        });
    },

    /**
     * Finds a specific non-reel inventory item by SKU and Location.
     * Assumes SKU + Location is a unique combination for non-reel items.
     * @param {string} sku - The SKU of the item.
     * @param {string} location - The Location of the item.
     * @returns {Promise<object|null>} A promise that resolves with the matching item or null if not found.
     */
    findItemBySkuAndLocation: (sku, location) => {
         return new Promise(async (resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));
            if (!sku || !location) return reject(new Error("SKU and Location are required."));
            const searchLocationLower = String(location).trim().toLowerCase();

            try {
                const transaction = DB.connection.transaction([DB.stores.inventory], 'readonly');
                const store = transaction.objectStore(DB.stores.inventory);
                const skuIndex = store.index('SKU_idx');
                const request = skuIndex.getAll(IDBKeyRange.only(sku));

                request.onsuccess = () => {
                    const itemsWithSku = request.result || [];
                    const foundItem = itemsWithSku.find(item =>
                        !item.isReel &&
                        String(item.location).trim().toLowerCase() === searchLocationLower
                    );
                    resolve(foundItem || null);
                };
                request.onerror = (event) => {
                    console.error(`Error finding item by SKU ${sku} and Location ${location}:`, event.target.error);
                    reject(event.target.error);
                };
            } catch (error) {
                console.error("Error initiating findItemBySkuAndLocation:", error);
                reject(error);
            }
        });
    },
    // --- END NEW Search Functions ---


    // --- Cycle, User Adjustments, Recount Query Functions ---
    saveCycle: function(cycleData) {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));
            if (!cycleData || !cycleData.cycleId) return reject(new Error("Cycle data requires a cycleId."));

            const transaction = DB.connection.transaction([DB.stores.countCycles], 'readwrite');
            const store = transaction.objectStore(DB.stores.countCycles);
            const request = store.put(cycleData); 

            request.onsuccess = (event) => resolve(event.target.result); 
            request.onerror = (event) => {
                console.error(`Error saving cycle (ID: ${cycleData.cycleId}):`, event.target.error);
                reject(event.target.error);
            };
            transaction.oncomplete = () => console.log(`Transaction completed: Saved cycle (ID: ${cycleData.cycleId})`);
            transaction.onerror = (event) => console.error("Transaction error saving cycle:", event.target.error);
        });
    },
    getOpenCycle: function() {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));

            const transaction = DB.connection.transaction([DB.stores.countCycles], 'readonly');
            const store = transaction.objectStore(DB.stores.countCycles);
            const index = store.index('by_status'); 
            const request = index.get('open'); 

            request.onsuccess = (event) => {
                resolve(event.target.result ? event.target.result : null);
            };
            request.onerror = (event) => {
                console.error("Error getting open cycle:", event.target.error);
                reject(event.target.error);
            };
        });
    },
     getCycleById: function(cycleId) {
         return new Promise((resolve, reject) => {
             if (!DB.connection) return reject(new Error("DB not initialized."));

             const transaction = DB.connection.transaction([DB.stores.countCycles], 'readonly');
             const store = transaction.objectStore(DB.stores.countCycles);
             const request = store.get(cycleId); 

             request.onsuccess = (event) => {
                 resolve(event.target.result ? event.target.result : null);
             };
             request.onerror = (event) => {
                 console.error(`Error getting cycle by ID (${cycleId}):`, event.target.error);
                 reject(event.target.error);
             };
         });
     },
     getRecountsForCycle: function(parentCycleId) {
         return DB._getAllByIndex(DB.stores.recountBatches, 'by_parentCycleId', parentCycleId, 'recounts for cycle', (a, b) => new Date(a.createdAt) - new Date(b.createdAt)); 
     },
    addAdjustment: function(adjustmentData) {
        return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not initialized."));
            if (!adjustmentData || !adjustmentData.SKU || adjustmentData.quantity === undefined || adjustmentData.label === undefined) {
                return reject(new Error("Adjustment data requires at least SKU, label, and quantity."));
            }
            const required = ['SKU', 'label', 'quantity', 'user', 'addedDuringCycleId']; 
             if (!adjustmentData.timestamp) {
                adjustmentData.timestamp = new Date().toISOString();
            }
            return DB._addOne(DB.stores.inventoryAdjustments, adjustmentData, required)
                .then(newId => {
                    console.log(`Transaction completed: Added user adjustment (ID: ${newId}, SKU: ${adjustmentData.SKU})`);
                    resolve(newId);
                })
                .catch(error => {
                     console.error(`Error adding user adjustment for SKU (${adjustmentData.SKU}):`, error);
                     reject(error); 
                });
        });
    },


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
                    if (sortFn && typeof sortFn === 'function') { result = result.sort(sortFn); }
                    console.log(`Loaded ${result.length} ${logName}.`);
                    resolve(result);
                };
                request.onerror = (event) => { console.error(`Error loading ${logName}:`, event.target.error); reject(event.target.error); };
                transaction.onerror = (event) => { console.error(`Read tx error loading ${logName}:`, event.target.error); reject(event.target.error); };
            } catch (error) { console.error(`Error init tx load ${logName}:`, error); reject(error); }
        });
    }, 
    _clearAndWrite: (storeName, data, requiredFields = []) => { 
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
                    if (data.length === 0) { console.log(`[DB._clearAndWrite:${storeName}] Data array is empty, nothing to write.`); resolve({ successCount, errorCount, skippedCount }); return; } // Resolve if nothing to write
                    
                    const writePromises = data.map(item => {
                        return new Promise((resolveItem, rejectItem) => { // Add rejectItem
                            try {
                                const request = store.put(item); 
                                request.onsuccess = () => { successCount++; resolveItem({ status: 'success' }); };
                                request.onerror = (event) => { console.error(`[DB._clearAndWrite:${storeName}] Error writing item (PUT):`, event.target.error, item); errorCount++; rejectItem(event.target.error); }; // Reject item promise
                            } catch (writeError) { console.error(`[DB._clearAndWrite:${storeName}] Sync error during PUT:`, writeError, item); errorCount++; rejectItem(writeError); } // Reject item promise
                        });
                    });
                     // Wait for all writes to settle
                    Promise.allSettled(writePromises).then(() => { 
                        console.log(`[DB._clearAndWrite:${storeName}] All write operations processed.`);
                        // Transaction oncomplete will handle final resolve/reject
                    });
                }; 
                transaction.oncomplete = () => {
                     console.log(`[DB._clearAndWrite:${storeName}] Transaction completed. S:${successCount}, F:${errorCount}, K:${skippedCount}. Items processed: ${data.length}`);
                     (errorCount === 0) ? resolve({ successCount, errorCount, skippedCount }) : reject(new Error(`${storeName} write tx completed with ${errorCount} errors.`));
                };
                transaction.onerror = (event) => { console.error(`[DB._clearAndWrite:${storeName}] Transaction error:`, event.target.error); reject(new Error(`Tx failed writing ${storeName}: ${event.target.error}`)); };
            } catch (error) { console.error(`[DB._clearAndWrite:${storeName}] Error initiating transaction:`, error); reject(error); }
        });
    }, 
     _addOne: (storeName, data, requiredFields = []) => { 
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
    }, 
    _getAllByIndex: (storeName, indexName, key, logName = 'items', sortFn = null) => { 
         return new Promise((resolve, reject) => {
            if (!DB.connection) return reject(new Error("DB not init"));
            if (key === undefined || key === null) { // Allow empty string for key if searching for blank values
                console.warn(`_getAllByIndex called with undefined or null key for index ${indexName} on ${storeName}.`);
                 // Depending on use case, you might want to allow this to search for items where the indexed property is null/undefined/empty.
                 // For now, treating it as potentially unintended, but proceeding.
            }
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
    }, 

    // --- Utility ---
    generateSimpleId: () => {
        const randomPart = Math.random().toString(36).substring(2, 11);
        const timePart = Date.now().toString(36);
        return `${timePart}-${randomPart}`;
    }, 

}; 
// --- END OF FILE offlineDB.js ---
