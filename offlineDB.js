// --- START OF FILE offlineDB.js ---
// Increment the database version to trigger onupgradeneeded.

const DB = {
    name: 'TelecomInventoryDB',
    version: 4, // <<-- Incremented version for schema changes (toCount, reelNumber)
    connection: null, // Hold the database connection
  
    // Initialize the database connection
    init: () => {
      return new Promise((resolve, reject) => {
        // ... (rest of the init setup) ...
        console.log(`Opening database ${DB.name} version ${DB.version}`); // Add log
        const request = indexedDB.open(DB.name, DB.version);
  
        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          const transaction = event.target.transaction;
          console.log(`Upgrading database from version ${event.oldVersion} to ${event.newVersion}`);
  
          // Create stores if they don't exist (versions 1, 2)
          if (!db.objectStoreNames.contains('inventory')) {
            console.log("Creating 'inventory' object store...");
            db.createObjectStore('inventory', { keyPath: 'SKU' });
          }
          if (!db.objectStoreNames.contains('transactionHistory')) {
             console.log("Creating 'transactionHistory' object store...");
             const historyStore = db.createObjectStore('transactionHistory', { keyPath: 'id', autoIncrement: true });
             historyStore.createIndex('sku_idx', 'SKU', { unique: false });
             historyStore.createIndex('timestamp_idx', 'timestamp', { unique: false });
          }
  
          // Version 3 Upgrade (Indexes)
          if (event.oldVersion < 3) {
              console.log("Applying version 3 upgrades (indexes)...");
               if (transaction) {
                   try { // Add try-catch around index creation
                       const invStore = transaction.objectStore('inventory');
                       if (!invStore.indexNames.contains('isActive_idx')) {
                          invStore.createIndex('isActive_idx', 'isActive', { unique: false });
                          console.log("Created 'isActive_idx' index.");
                       }
                   } catch (e) {
                       console.error("Error applying V3 index upgrades:", e);
                       // Don't necessarily stop the whole upgrade, but log it.
                   }
              } else {
                   console.warn("No transaction for V3 index upgrades.");
              }
          }
  
          // --- Version 4 Upgrades (Add toCount index) ---
          if (event.oldVersion < 4) {
              console.log("Applying version 4 upgrades (toCount index)...");
               if (transaction) {
                   try { // Add try-catch
                       const invStore = transaction.objectStore('inventory');
                       // Add index for filtering by toCount status
                       if (!invStore.indexNames.contains('toCount_idx')) {
                          invStore.createIndex('toCount_idx', 'toCount', { unique: false });
                          console.log("Created 'toCount_idx' index on inventory store.");
                       }
                        // Note: Adding reelNumber doesn't strictly need an index unless frequent lookups by it are planned.
                   } catch (e) {
                        console.error("Error applying V4 index upgrades:", e);
                   }
              } else {
                   console.warn("No transaction for V4 index upgrades.");
              }
          }
          console.log("Database upgrade complete.");
        };
  
        // ... (rest of init: onsuccess, onerror) ...
         request.onsuccess = (event) => { DB.connection = event.target.result; /*...*/ resolve(DB.connection); };
         request.onerror = (event) => { /*...*/ reject(request.error); };
      });
    },
  
    // ... (rest of offlineDB.js: saveInventory, loadInventory, history functions, generateSimpleId) ...
     // No other changes strictly required in offlineDB.js for this refactor,
     // as the new fields are handled by applyDataDefaults and standard put operations.
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
