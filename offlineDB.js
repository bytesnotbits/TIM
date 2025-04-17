// --- START OF FILE offlineDB.js ---
// Increment the database version to trigger onupgradeneeded.

const DB = {
    name: 'TelecomInventoryDB',
    version: 4, // <<-- Incremented version for schema changes (toCount, reelNumber)
    connection: null, // Hold the database connection

    // Initialize the database connection
    init: () => {
        return new Promise((resolve, reject) => {
            if (DB.connection) {
                console.log("Database connection already established.");
                return resolve(DB.connection);
            }
            console.log(`Opening database ${DB.name} version ${DB.version}`);
            const request = indexedDB.open(DB.name, DB.version);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const transaction = event.target.transaction;
                console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);

                // --- Inventory Store ---
                let invStore;
                if (!db.objectStoreNames.contains('inventory')) {
                    console.log("Creating 'inventory' object store...");
                    invStore = db.createObjectStore('inventory', { keyPath: 'SKU' });
                } else {
                    invStore = transaction.objectStore('inventory');
                }

                // --- Transaction History Store ---
                let historyStore;
                if (!db.objectStoreNames.contains('transactionHistory')) {
                    console.log("Creating 'transactionHistory' object store...");
                    historyStore = db.createObjectStore('transactionHistory', { keyPath: 'id', autoIncrement: true });
                } else {
                    // If history store exists, ensure transaction is available for potential index adds later
                    historyStore = transaction.objectStore('transactionHistory');
                }


                // --- Index Creation/Verification (Idempotent) ---

                // Inventory Indexes
                if (!invStore.indexNames.contains('isActive_idx')) {
                    invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    console.log("Created 'isActive_idx' index on inventory.");
                }
                 if (!invStore.indexNames.contains('toCount_idx')) {
                    invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                    console.log("Created 'toCount_idx' index on inventory.");
                }
                 // Add other inventory indexes here if needed in the future

                // Transaction History Indexes
                if (!historyStore.indexNames.contains('sku_idx')) {
                    historyStore.createIndex('sku_idx', 'SKU', { unique: false });
                     console.log("Created 'sku_idx' index on transactionHistory.");
                }
                if (!historyStore.indexNames.contains('timestamp_idx')) {
                    historyStore.createIndex('timestamp_idx', 'timestamp', { unique: false });
                     console.log("Created 'timestamp_idx' index on transactionHistory.");
                }

                 console.log("Database upgrade/schema check complete.");
            };

            request.onsuccess = (event) => {
                DB.connection = event.target.result;
                console.log("Database connection successful.");

                // Add error handling for the connection itself
                DB.connection.onerror = (event) => {
                    console.error("Database error:", event.target.errorCode);
                };

                resolve(DB.connection);
            };

            request.onerror = (event) => {
                console.error("Database initialization error:", request.error);
                reject(request.error);
            };

            request.onblocked = () => {
                console.warn("Database connection blocked. Please close other tabs using this app.");
                // Optionally alert the user
                alert("Database update blocked. Please close other tabs/windows running this application and refresh.");
                 reject(new Error("Database connection blocked"));
            };
        });
    },

    // *** ADD THIS FUNCTION ***
    loadInventory: () => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) {
                return reject(new Error("Database connection is not available. Call DB.init() first."));
            }
            try {
                const transaction = DB.connection.transaction(['inventory'], 'readonly');
                const store = transaction.objectStore('inventory');
                const request = store.getAll(); // Get all items

                request.onsuccess = () => {
                    console.log(`Loaded ${request.result ? request.result.length : 0} items from inventory store.`);
                    resolve(request.result || []); // Resolve with the array of items or empty array
                };

                request.onerror = (event) => {
                    console.error("Error loading inventory from store:", event.target.error);
                    reject(new Error(`Failed to load inventory: ${event.target.error}`));
                };

                transaction.onerror = (event) => {
                    console.error("Transaction error loading inventory:", event.target.error);
                    reject(new Error(`Transaction failed while loading inventory: ${event.target.error}`));
                };
                transaction.oncomplete = () => { // Good practice to log completion
                    console.log("Read transaction for loading inventory completed.");
                };
            } catch (error) {
                 console.error("Error initiating transaction to load inventory:", error);
                 reject(new Error(`Failed to start transaction for loading inventory: ${error.message}`));
            }
        });
    },
    // *** END OF ADDED FUNCTION ***

    saveInventory: (inventoryData) => {
        // ...(rest of saveInventory function)...
        return new Promise(async (resolve, reject) => { // Make sure it returns a promise
            if (!DB.connection) {
                return reject(new Error("Database connection is not available. Call DB.init() first."));
            }
            if (!Array.isArray(inventoryData)) {
                 console.error("saveInventory received non-array data:", inventoryData);
                 return reject(new Error("Invalid data format: Expected an array for inventory."));
            }

            try {
                const transaction = DB.connection.transaction(['inventory'], 'readwrite');
                const store = transaction.objectStore('inventory');
                let successCount = 0;
                let errorCount = 0;

                // Clear the store first (be careful with large datasets, but simplest for sync)
                const clearRequest = store.clear();
                clearRequest.onsuccess = () => {
                     console.log("Inventory store cleared. Starting save...");

                     // Use Promise.allSettled to handle individual item save errors gracefully
                     const savePromises = inventoryData.map(item => {
                         return new Promise((resolveItem, rejectItem) => {
                            if (!item || typeof item.SKU !== 'string' || item.SKU.trim() === '') {
                                console.warn("Skipping invalid item during save:", item);
                                return rejectItem(new Error("Invalid item data (missing/invalid SKU)")); // Reject promise for this item
                            }
                            try {
                                const request = store.put(item); // Use put for add/update
                                request.onsuccess = () => {
                                    successCount++;
                                    resolveItem(); // Resolve promise for this item
                                };
                                request.onerror = (event) => {
                                    console.error(`Error saving item ${item.SKU}:`, event.target.error);
                                    errorCount++;
                                    rejectItem(event.target.error); // Reject promise for this item
                                };
                            } catch (putError) {
                                 console.error(`Synchronous error putting item ${item.SKU}:`, putError);
                                 errorCount++;
                                 rejectItem(putError); // Reject promise for this item
                            }
                         });
                     });

                    Promise.allSettled(savePromises).then(results => {
                         // Log results of individual saves if needed
                         results.forEach((result, index) => {
                            if (result.status === 'rejected') {
                                console.warn(`Failed to save item at index ${index}:`, result.reason);
                            }
                         });
                         console.log(`Inventory save attempt finished. Success: ${successCount}, Failed: ${errorCount}`);
                         // Even if some fail, the transaction might still commit what succeeded before the error
                    });
                };
                 clearRequest.onerror = (event) => {
                    console.error("Error clearing inventory store:", event.target.error);
                    reject(new Error(`Failed to clear inventory store: ${event.target.error}`));
                 };


                transaction.oncomplete = () => {
                    console.log(`Inventory save transaction completed. ${successCount} items processed (check logs for errors).`);
                    resolve({ successCount, errorCount });
                };

                transaction.onerror = (event) => {
                    console.error("Transaction error saving inventory:", event.target.error);
                    reject(new Error(`Transaction failed while saving inventory: ${event.target.error}`));
                };
            } catch (error) {
                console.error("Error initiating transaction to save inventory:", error);
                reject(new Error(`Failed to start transaction for saving inventory: ${error.message}`));
            }
        });
    },

     loadTransactionHistory: () => {
        // ...(rest of loadTransactionHistory function)...
        return new Promise((resolve, reject) => {
            if (!DB.connection) {
                return reject(new Error("Database connection is not available. Call DB.init() first."));
            }
            try {
                const transaction = DB.connection.transaction(['transactionHistory'], 'readonly');
                const store = transaction.objectStore('transactionHistory');
                const request = store.getAll();

                request.onsuccess = () => {
                    console.log(`Loaded ${request.result ? request.result.length : 0} history records.`);
                    // Optional: Sort here if needed, e.g., descending by timestamp
                    // const sortedHistory = (request.result || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    // resolve(sortedHistory);
                    resolve(request.result || []);
                };
                 request.onerror = (event) => {
                    console.error("Error loading transaction history:", event.target.error);
                    reject(new Error(`Failed to load transaction history: ${event.target.error}`));
                };
                 transaction.onerror = (event) => {
                    console.error("Transaction error loading history:", event.target.error);
                    reject(new Error(`Transaction failed while loading history: ${event.target.error}`));
                 };
            } catch (error) {
                 console.error("Error initiating transaction to load history:", error);
                 reject(new Error(`Failed to start transaction for loading history: ${error.message}`));
            }
        });
    },

    saveTransactionHistory: (historyData) => {
        // ...(rest of saveTransactionHistory function)...
        return new Promise(async (resolve, reject) => { // Make async if using await inside
            if (!DB.connection) {
                return reject(new Error("Database connection is not available. Call DB.init() first."));
            }
            if (!Array.isArray(historyData)) {
                console.error("saveTransactionHistory received non-array data:", historyData);
                return reject(new Error("Invalid data format: Expected an array for history."));
            }
            try {
                const transaction = DB.connection.transaction(['transactionHistory'], 'readwrite');
                const store = transaction.objectStore('transactionHistory');
                let successCount = 0;
                let errorCount = 0;

                // Clear the store first
                const clearRequest = store.clear();
                clearRequest.onsuccess = () => {
                    console.log("Transaction history store cleared. Starting save...");
                    // Use Promise.allSettled for robustness
                    const savePromises = historyData.map(entry => {
                        return new Promise((resolveItem, rejectItem) => {
                            // Add minimal validation for history entries if needed
                            if (!entry || typeof entry.timestamp !== 'string') {
                                console.warn("Skipping invalid history entry:", entry);
                                return rejectItem(new Error("Invalid history entry format"));
                            }
                            try {
                                // Since history has autoIncrement key, use add()
                                const request = store.add(entry);
                                request.onsuccess = () => {
                                    successCount++;
                                    resolveItem();
                                };
                                request.onerror = (event) => {
                                    console.error("Error saving history entry:", event.target.error, entry);
                                    errorCount++;
                                    rejectItem(event.target.error);
                                };
                             } catch (addError) {
                                console.error("Synchronous error adding history entry:", addError, entry);
                                errorCount++;
                                rejectItem(addError);
                            }
                        });
                    });

                     Promise.allSettled(savePromises).then(results => {
                        // Log results if needed
                        console.log(`History save attempt finished. Success: ${successCount}, Failed: ${errorCount}`);
                    });
                };
                clearRequest.onerror = (event) => {
                     console.error("Error clearing transaction history store:", event.target.error);
                     reject(new Error(`Failed to clear transaction history store: ${event.target.error}`));
                };

                transaction.oncomplete = () => {
                    console.log(`Transaction history save transaction completed. ${successCount} entries processed.`);
                    resolve({ successCount, errorCount });
                };
                transaction.onerror = (event) => {
                    console.error("Transaction error saving history:", event.target.error);
                    reject(new Error(`Transaction failed while saving history: ${event.target.error}`));
                };
            } catch (error) {
                console.error("Error initiating transaction to save history:", error);
                reject(new Error(`Failed to start transaction for saving history: ${error.message}`));
            }
        });
    },

    addTransaction: (transactionData) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) {
                return reject(new Error("Database connection is not available."));
            }
            try {
                const transaction = DB.connection.transaction(['transactionHistory'], 'readwrite');
                const store = transaction.objectStore('transactionHistory');
                const request = store.add(transactionData); // Use add for auto-increment key

                request.onsuccess = (event) => {
                    console.log("Transaction added successfully with key:", event.target.result);
                    resolve(event.target.result); // Resolve with the new key
                };

                request.onerror = (event) => {
                    console.error("Error adding transaction:", event.target.error);
                    reject(new Error(`Failed to add transaction: ${event.target.error}`));
                };

                transaction.onerror = (event) => {
                    console.error("Transaction error adding transaction:", event.target.error);
                     // Don't reject here if request.onerror already did
                };
            } catch (error) {
                 console.error("Error initiating transaction to add transaction:", error);
                 reject(new Error(`Failed to start transaction for adding transaction: ${error.message}`));
            }
        });
    },

    getTransactionHistoryBySKU: (sku) => {
        return new Promise((resolve, reject) => {
            if (!DB.connection) {
                return reject(new Error("Database connection is not available."));
            }
             if (!sku) {
                 return reject(new Error("SKU is required to fetch item history."));
             }
            try {
                const transaction = DB.connection.transaction(['transactionHistory'], 'readonly');
                const store = transaction.objectStore('transactionHistory');
                const index = store.index('sku_idx'); // Use the SKU index
                const request = index.getAll(sku); // Get all records matching the SKU

                request.onsuccess = () => {
                    console.log(`Found ${request.result ? request.result.length : 0} history records for SKU ${sku}.`);
                    // Sort descending by timestamp
                    const sortedHistory = (request.result || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                    resolve(sortedHistory);
                };

                request.onerror = (event) => {
                    console.error(`Error fetching history for SKU ${sku}:`, event.target.error);
                    reject(new Error(`Failed to fetch history for SKU ${sku}: ${event.target.error}`));
                };
                 transaction.onerror = (event) => {
                     console.error("Transaction error fetching item history:", event.target.error);
                      // Don't reject here if request.onerror already did
                 };

            } catch (error) {
                console.error(`Error initiating transaction to fetch history for SKU ${sku}:`, error);
                reject(new Error(`Failed to start transaction for fetching item history: ${error.message}`));
            }
        });
    },

    generateSimpleId: () => {
        // Basic pseudo-random ID generator
        return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
    }

};
// --- END OF FILE offlineDB.js ---
