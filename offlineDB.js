// --- START OF FILE offlineDB.js ---

const DB = {
  name: 'TelecomInventoryDB',
  version: 3, // <<-- Incremented version for schema changes
  connection: null, // Hold the database connection

  // Initialize the database connection
  init: () => {
    return new Promise((resolve, reject) => {
      // If connection already exists, resolve it
      if (DB.connection) {
        return resolve(DB.connection);
      }

      console.log(`Opening database ${DB.name} version ${DB.version}`);
      const request = indexedDB.open(DB.name, DB.version);

      // --- Schema Setup and Upgrades ---
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        const transaction = event.target.transaction; // Get transaction for safety
        console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);

        // Create 'inventory' store if it doesn't exist (for version 1+)
        if (!db.objectStoreNames.contains('inventory')) {
          console.log("Creating 'inventory' object store...");
          // Still using SKU as the primary key for easy lookups during counting
          db.createObjectStore('inventory', { keyPath: 'SKU' });
          // Add indexes if needed later (e.g., on description, location)
          // store.createIndex('description', 'description', { unique: false });
        }

        // Create 'transactionHistory' store if it doesn't exist (for version 2+)
        if (!db.objectStoreNames.contains('transactionHistory')) {
           console.log("Creating 'transactionHistory' object store...");
           // Use autoIncrementing key for simple log entries
           const historyStore = db.createObjectStore('transactionHistory', { keyPath: 'id', autoIncrement: true });
           // Add index on SKU for item-specific history lookup
           historyStore.createIndex('sku_idx', 'SKU', { unique: false });
           // Add index on timestamp for sorting/filtering
           historyStore.createIndex('timestamp_idx', 'timestamp', { unique: false });
           console.log("Created indexes on transactionHistory store.");
        }

        // --- Version 3 Upgrades ---
        if (event.oldVersion < 3) {
            console.log("Applying version 3 upgrades to 'inventory' store (adding indexes)...");
            // Although adding fields doesn't require schema change for data,
            // we might want indexes for performance or future features.
            if (transaction) { // Ensure transaction exists
                 const invStore = transaction.objectStore('inventory');
                 // Example: Index for filtering by isActive status
                 if (!invStore.indexNames.contains('isActive_idx')) {
                    invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                    console.log("Created 'isActive_idx' index on inventory store.");
                 }
                 // Example: Index for item ID lookup (if needed frequently)
                 // if (!invStore.indexNames.contains('itemId_idx')) {
                 //    invStore.createIndex('itemId_idx', 'itemId', { unique: false }); // Assuming itemId might not be unique if data is messy
                 //    console.log("Created 'itemId_idx' index on inventory store.");
                 // }
            } else {
                console.warn("Could not get transaction during upgrade to version 3 to add indexes.");
            }
        }

        console.log("Database upgrade complete.");
      };

      // --- Connection Success/Error ---
      request.onsuccess = (event) => {
        DB.connection = event.target.result;
        console.log(`Database ${DB.name} opened successfully.`);

        // Optional: Add generic error handler for the connection
        DB.connection.onerror = (event) => {
            console.error("Database error:", event.target.error);
        };

        resolve(DB.connection);
      };

      request.onerror = (event) => {
        console.error(`Database error: ${event.target.errorCode}`);
        reject(request.error);
      };
    });
  },

  // --- Inventory Operations ---

  // Save the entire inventory list (overwrites existing)
  saveInventory: async (inventoryItems) => {
    const db = await DB.init(); // Ensure connection is open
    return new Promise((resolve, reject) => {
        const tx = db.transaction('inventory', 'readwrite');
        const store = tx.objectStore('inventory');

        // Clear existing data first
        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
            console.log(`Cleared inventory store. Adding ${inventoryItems.length} items.`);
            // Add all new items
            inventoryItems.forEach(item => {
                // Ensure item has an itemId before saving
                if (!item.itemId) {
                    console.warn(`Item ${item.SKU} missing itemId, generating one.`);
                    item.itemId = DB.generateSimpleId(); // Assign an ID if missing
                }
                // Add error handling per item if needed
                try {
                  store.put(item);
                } catch (e) {
                  console.error(`Failed to put item ${item.SKU}:`, e);
                  // Decide how to handle individual errors - skip? abort?
                }
            });
        };
        clearRequest.onerror = (event) => {
            console.error("Error clearing inventory store:", event.target.error);
            reject(event.target.error);
        };


        tx.oncomplete = () => {
            console.log("Inventory save transaction completed.");
            resolve();
        };
        tx.onerror = (event) => {
            console.error("Inventory save transaction error:", event.target.error);
            reject(event.target.error);
        };
    });
  },

  // Load all inventory items
  loadInventory: async () => {
    const db = await DB.init();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('inventory', 'readonly');
        const store = tx.objectStore('inventory');
        const request = store.getAll();

        request.onsuccess = () => {
            console.log(`Loaded ${request.result.length} items from inventory store.`);
            resolve(request.result);
        };
        request.onerror = (event) => {
            console.error("Load inventory request error:", event.target.error);
            reject(event.target.error);
        };
        tx.onerror = (event) => { // Catch transaction errors too
            console.error("Load inventory transaction error:", event.target.error);
            reject(event.target.error);
        };
    });
  },

  // --- Transaction History Operations ---

  // Save the entire transaction history (overwrites existing)
  saveTransactionHistory: async (historyItems) => {
    const db = await DB.init();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('transactionHistory', 'readwrite');
        const store = tx.objectStore('transactionHistory');

        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
            console.log(`Cleared transactionHistory store. Adding ${historyItems.length} items.`);
            historyItems.forEach(item => {
                const itemToSave = { ...item };
                // If items have an 'id' from a previous save/load, 'put' will respect it.
                // If they don't, 'put' with an autoIncrement key will add a new one.
                // Clearing first ensures only the current array state is saved.
                try {
                    store.put(itemToSave);
                } catch (e) {
                    console.error(`Failed to put transaction:`, e, itemToSave);
                }
            });
        };
         clearRequest.onerror = (event) => {
            console.error("Error clearing transactionHistory store:", event.target.error);
            reject(event.target.error);
        };

        tx.oncomplete = () => {
            console.log("Transaction history save transaction completed.");
            resolve();
        };
        tx.onerror = (event) => {
            console.error("Transaction history save transaction error:", event.target.error);
            reject(event.target.error);
        };
    });
  },

   // Load all transaction history items
  loadTransactionHistory: async () => {
    const db = await DB.init();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('transactionHistory', 'readonly');
        const store = tx.objectStore('transactionHistory');
        const request = store.getAll(); // Consider getAll(null, count) or iterating with cursor for very large histories

        request.onsuccess = () => {
            console.log(`Loaded ${request.result.length} items from transactionHistory store.`);
            resolve(request.result);
        };
        request.onerror = (event) => {
            console.error("Load transaction history request error:", event.target.error);
            reject(event.target.error);
        };
         tx.onerror = (event) => { // Catch transaction errors too
            console.error("Load transaction history transaction error:", event.target.error);
            reject(event.target.error);
        };
    });
  },

  // Get transaction history for a specific SKU
  getTransactionHistoryBySKU: async (sku) => {
      const db = await DB.init();
      return new Promise((resolve, reject) => {
          const tx = db.transaction('transactionHistory', 'readonly');
          const store = tx.objectStore('transactionHistory');
          const index = store.index('sku_idx'); // Use the index
          const request = index.getAll(sku); // Get all entries matching the SKU

          request.onsuccess = () => {
              console.log(`Found ${request.result.length} history entries for SKU ${sku}.`);
              // Sort by timestamp descending (newest first) for display
              request.result.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
              resolve(request.result);
          };
          request.onerror = (event) => {
              console.error(`Error fetching history for SKU ${sku}:`, event.target.error);
              reject(event.target.error);
          };
          tx.onerror = (event) => {
              console.error("Transaction error fetching history by SKU:", event.target.error);
              reject(event.target.error);
          };
      });
  },


  // Example: Function to add a *single* transaction (more efficient for logging)
  addTransaction: async (transaction) => {
      const db = await DB.init();
      return new Promise((resolve, reject) => {
          const tx = db.transaction('transactionHistory', 'readwrite');
          const store = tx.objectStore('transactionHistory');
          // No need to set 'id' if store uses autoIncrement
          const request = store.add(transaction);

          request.onsuccess = (event) => {
              // event.target.result will be the new auto-incremented ID
              resolve(event.target.result);
          };
          request.onerror = (event) => {
              console.error("Add transaction request error:", event.target.error);
              reject(event.target.error);
          };
          tx.onerror = (event) => {
              console.error("Add transaction transaction error:", event.target.error);
              reject(event.target.error);
          };
      });
  },

   // Helper to generate a simple unique-enough ID (replace with UUID library if needed)
   generateSimpleId: () => {
       return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
   }

};

// --- END OF FILE offlineDB.js ---

/*
Summary of Persistence Changes:
Database version incremented to 2.

onupgradeneeded now correctly creates both inventory and transactionHistory stores based on the old version.

A single DB.init manages the connection.

saveInventory now correctly clears the store and uses put for each item.

saveTransactionHistory and loadTransactionHistory added, using the new transactionHistory store. They also use the clear-then-add-all approach for simplicity.

addTransaction function added as a more efficient alternative for single log entries (though not used by autoSave in this version).

Removed unused openDB and pendingTransactions store.

Improved promise handling and error logging for DB operations.
*/