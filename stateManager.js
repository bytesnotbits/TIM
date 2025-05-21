// --- Global State ---
let database = { inventory: [], transactionHistory: [] };
// ADD filterByToCountStatus, initialize to 'to_count'
let currentFilters = { location: null, status: 'active', searchTerm: '', filterByToCountStatus: 'to_count' };
let currentInventory = [];
let currentUserIdentifier = 'Default User'; // User identifier state

// Check if DB object exists from offlineDB.js
if (typeof DB === 'undefined') {
    console.error("CRITICAL: offlineDB.js is not loaded or DB object is not defined.");
    alert("CRITICAL ERROR: Database library not loaded. App cannot function.");
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeApp().then(() => {
        // Call setupEventListeners from eventHandlers.js *after* init is done
        if (typeof setupEventListeners === 'function') {
            setupEventListeners();
            console.log("App initialized and event listeners set up.");
        } else {
             console.error("setupEventListeners function not found. Event handling will not work.");
             alert("ERROR: UI Event setup failed.");
        }
    }).catch(error => {
        console.error("Caught initialization error at top level:", error);
        // Use displayInitializationError from uiRenderer.js
        if (typeof displayInitializationError === 'function') {
            displayInitializationError("A critical error occurred during application startup. Some features might be unavailable. Please check the console for details.");
        } else {
            alert("CRITICAL ERROR during initialization. UI feedback unavailable.");
        }
    });
});


async function initializeApp() {
    try {
        console.log("Initializing application...");

        currentUserIdentifier = localStorage.getItem('tim_user_identifier') || 'Default User';
        const userInput = document.getElementById('userIdentifierInput');
        if (userInput) userInput.value = currentUserIdentifier;

        await DB.init();

        const results = await Promise.allSettled([
            DB.loadInventory(),
            DB.loadTransactionHistory()
        ]);

        const inventoryResult = results[0];
        const historyResult = results[1];

        if (inventoryResult.status === 'fulfilled' && inventoryResult.value) {
            // Apply defaults immediately after loading (applyDataDefaults should be in dataLogic.js)
            if (typeof applyDataDefaults === 'function') {
                database.inventory = applyDataDefaults(inventoryResult.value);
                console.log(`Loaded and processed ${database.inventory.length} inventory items.`);
            } else {
                console.error("applyDataDefaults function not found. Cannot process inventory.");
                database.inventory = inventoryResult.value || []; // Load raw data at least
            }
        } else {
            console.error("Failed to load inventory:", inventoryResult.reason || "No data returned");
            database.inventory = [];
             if (typeof displayError === 'function') {
                 displayError("Could not load inventory data from storage. Using empty list.", document.getElementById('inventoryList'));
             }
        }

        if (historyResult.status === 'fulfilled' && historyResult.value) {
            database.transactionHistory = historyResult.value || [];
            // Sort history initially if needed (e.g., by timestamp descending)
            database.transactionHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            console.log(`Loaded ${database.transactionHistory.length} history records.`);
        } else {
            console.error("Failed to load transaction history:", historyResult.reason || "No data returned");
            database.transactionHistory = [];
            if (typeof displayError === 'function') {
                displayError("Could not load transaction history from storage.", document.getElementById('historyListContainer'));
            }
        }

        // Initial filter application and UI rendering
        // Uses functions now in dataLogic.js and uiRenderer.js
        if (typeof applyCurrentFilters === 'function') {
            applyCurrentFilters(); // This will use the initial state of currentFilters
        } else {
             console.error("applyCurrentFilters function not found. Cannot apply initial filters.");
        }
         if (typeof renderInventoryList === 'function') {
            renderInventoryList();
         } else {
              console.error("renderInventoryList function not found. Cannot display inventory.");
         }
         if (typeof updateSummaryCards === 'function') {
             updateSummaryCards();
         } else {
               console.error("updateSummaryCards function not found. Cannot update summary.");
         }


    } catch (error) {
        console.error("Critical initialization error:", error);
         if (typeof displayInitializationError === 'function') {
             displayInitializationError(`Critical Error: Failed to initialize application storage. Data cannot be loaded or saved. ${error.message}`);
         } else {
              alert(`CRITICAL INIT ERROR: ${error.message}. UI feedback unavailable.`);
         }
        throw error;
    }
}


// --- User Identifier Management ---
function getUserIdentifier() {
    return currentUserIdentifier;
}


function updateUserIdentifier(name) {
    const trimmedName = name.trim();
    if (trimmedName) {
        currentUserIdentifier = trimmedName;
        try {
            localStorage.setItem('tim_user_identifier', currentUserIdentifier);
            console.log(`User identifier updated to: ${currentUserIdentifier}`);
        } catch (e) {
            console.error("Failed to save user identifier to localStorage:", e);
            alert("Warning: Could not save your name preference.");
        }
    } else {
        currentUserIdentifier = 'Default User';
        localStorage.removeItem('tim_user_identifier');
        const userInput = document.getElementById('userIdentifierInput');
        if (userInput) userInput.value = '';
        console.log("User identifier reset to default.");
    }
}


// --- Data Persistence (autoSave) ---
async function autoSave() {
    try {
        if (!DB.connection) {
            console.warn("DB connection not ready for autosave. Attempting init.");
            await DB.init();
        }

        const inventoryDataToSave = database.inventory; // Reference the current state

        // Save only inventory
        try {
            await DB.saveInventory(inventoryDataToSave);
            console.log("Autosave completed for inventory to IndexedDB.");
        } catch (invSaveError) {
            console.error("Auto-save failed for inventory:", invSaveError);
            // Optionally alert user on save failure?
            // alert("Warning: Failed to automatically save inventory changes.");
        }

        // Transaction history is saved via individual addTransaction calls now.

    } catch (error) {
        console.error("Unexpected error during auto-save process:", error);
    }
}


// --- Audit Trail ---
async function logTransaction(transactionData) { // Make the function async
    try {
        const timestamp = new Date().toISOString();
        const user = getUserIdentifier();

        const fullTransaction = {
            // id will be assigned by IndexedDB autoIncrement
            timestamp: timestamp,
            user: user,
            ...transactionData // Includes type, SKU, itemId, details etc.
        };

        // 1. Attempt to add to IndexedDB FIRST
        const addedTransactionId = await DB.addTransaction(fullTransaction); // Use the async DB function
        console.log(`Transaction logged to DB with ID: ${addedTransactionId}`, fullTransaction);

        // 2. If DB add was successful, update the in-memory array
        // Assign the ID returned by the DB to the in-memory copy
        fullTransaction.id = addedTransactionId;
        database.transactionHistory.unshift(fullTransaction); // Add to beginning

        // Sort the in-memory history just in case order matters for immediate display
        // (though unshift keeps it reverse-chrono if loaded correctly initially)
        database.transactionHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));


        // Update global history view if visible
        if (document.getElementById('history-view')?.style.display !== 'none') {
            try {
                renderHistoryView(); // Re-render the full history view with the new item
            } catch (renderError) {
                 console.error("Error rendering history view after logging transaction:", renderError);
            }
        }
        // No need to re-render item history modal here, it fetches fresh data when opened

    } catch (error) {
        // Log the error, but don't necessarily halt execution unless critical
        console.error("Error logging transaction (DB add or memory update):", error, transactionData);
         // Optionally alert the user if DB logging fails?
         // alert(`Warning: Failed to record transaction history entry. ${error.message}`);
    }
}


// --- Error Handling Wrappers ---
function wrapAction(func, actionName) {
    return async (...args) => {
        try {
            await func(...args);
        } catch (error) {
            console.error(`Error during action [${actionName}]:`, error);
            alert(`An error occurred while trying to ${actionName}. Please check the console for details.\n\n${error.message}`);
        }
    };
}


function wrapHandler(handlerFunc, handlerName) {
    return (...eventArgs) => {
        try {
            handlerFunc(...eventArgs);
        } catch (error) {
            console.error(`Error in event handler [${handlerName}]:`, error);
            // Potentially alert the user for critical handler errors? Usually console log is sufficient.
            // alert(`UI Error: An interaction failed unexpectedly. (${handlerName})`);
        }
    };
}

