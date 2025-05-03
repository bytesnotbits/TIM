// --- START OF FILE appLogic.js ---

// Check if required libraries are loaded
if (typeof Papa === 'undefined') {
    console.error("PapaParse library not found. Please include papaparse.min.js.");
    alert("Error: CSV library not loaded. CSV features will not work.");
}
// Defer PDF library check until export function is called

// --- Global State ---
let database = { inventory: [], transactionHistory: [] };
// ADD filterByToCountStatus, initialize to 'to_count'
let currentFilters = { location: null, status: 'active', searchTerm: '', filterByToCountStatus: 'to_count' };
let currentInventory = [];
let currentUserIdentifier = 'Default User'; // User identifier state

// --- Helper function to apply default values or migrate data structures ---
function applyDataDefaults(inventoryItems) {
    if (!Array.isArray(inventoryItems)) {
        console.error("applyDataDefaults received non-array:", inventoryItems);
        return []; // Return empty array to avoid downstream errors
    }
    inventoryItems.forEach(item => {
        if (!item || typeof item !== 'object') return; // Skip invalid items

        // --- Unique Item ID ---
        item.itemId = item.itemId ?? DB.generateSimpleId(); // Ensure every item has a persistent ID

        // --- Core Count Fields ---
        item.counted = item.counted ?? null;
        if (item.isUncounted === undefined || item.isUncounted === null) {
            item.isUncounted = (item.counted === null);
        }

        // --- Cable Footage Fields ---
        item.isReel = item.isReel ?? false; // Default to not a reel
        item.reelNumber = item.reelNumber ?? ''; // NEW: Reel number identifier
        item.isTwoWayReel = item.isReel && (item.isTwoWayReel ?? false); // Can only be two-way if it's a reel
        item.innerSequence = item.innerSequence ?? '';
        item.outerSequence = item.outerSequence ?? '';
        item.innerSequence2 = item.innerSequence2 ?? '';
        item.outerSequence2 = item.outerSequence2 ?? '';
        item.calculatedFootage = item.calculatedFootage ?? null;
        item.footageFactor = item.footageFactor ?? null;

        // --- Metadata & Status ---
        item.notes = item.notes ?? ''; // Default notes to empty string
        item.isActive = item.isActive ?? true; // Default to active
        item.lastCountTimestamp = item.lastCountTimestamp ?? null;
        item.capturedQuantity = item.capturedQuantity ?? null; // Expected quantity (optional)
        item.toCount = item.toCount ?? false; // NEW: Flag for current count cycle, default false
        // --- NEW: Recount Tracking ---
        item.currentRecountBatchId = item.currentRecountBatchId ?? null; // Track which recount batch item belongs to (if any)

        // --- Basic Info ---
        item.SKU = item.SKU ?? 'UNKNOWN_SKU';
        item.Description = item.Description ?? 'No Description';
        item.location = item.location ?? 'No Location';
    });
    console.log("Applied data defaults (including toCount, reelNumber, currentRecountBatchId) to inventory items.");
    return inventoryItems; // Return the processed array
}


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    initializeApp().then(() => {
        setupEventListeners();
        console.log("App initialized and event listeners set up.");
    }).catch(error => {
        console.error("Caught initialization error at top level:", error);
        displayInitializationError("A critical error occurred during application startup. Some features might be unavailable. Please check the console for details.");
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
            // Apply defaults immediately after loading
            database.inventory = applyDataDefaults(inventoryResult.value);
            console.log(`Loaded and processed ${database.inventory.length} inventory items.`);
        } else {
            console.error("Failed to load inventory:", inventoryResult.reason || "No data returned");
            database.inventory = [];
            displayError("Could not load inventory data from storage. Using empty list.", document.getElementById('inventoryList'));
        }

        if (historyResult.status === 'fulfilled' && historyResult.value) {
            database.transactionHistory = historyResult.value || [];
            // Sort history initially if needed (e.g., by timestamp descending)
            database.transactionHistory.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            console.log(`Loaded ${database.transactionHistory.length} history records.`);
        } else {
            console.error("Failed to load transaction history:", historyResult.reason || "No data returned");
            database.transactionHistory = [];
            displayError("Could not load transaction history from storage.", document.getElementById('historyListContainer'));
        }

        // Initial filter application and UI rendering
        // Apply default filters ('active', 'to_count')
        applyCurrentFilters(); // This will use the initial state of currentFilters
        renderInventoryList();
        updateSummaryCards();

    } catch (error) {
        console.error("Critical initialization error:", error);
        displayInitializationError(`Critical Error: Failed to initialize application storage. Data cannot be loaded or saved. ${error.message}`);
        throw error;
    }
}

// Helper to display critical init errors
function displayInitializationError(message) {
    const container = document.getElementById('initialization-error-container');
    if (container) {
        container.innerHTML = `<div class="error-message">${message}</div>`;
        container.style.display = 'block';
    }
    document.querySelectorAll('.quick-actions button, header button, .filter-controls button').forEach(btn => btn.disabled = true);
}

// Helper to display non-critical errors within specific containers
function displayError(message, containerElement) {
    if (containerElement) {
        containerElement.innerHTML = `<p class="error-message" style="margin: 0;">${message}</p>`;
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

// --- Event Listener Setup ---
function setupEventListeners() {
    try {
        // Hamburger Menu
        const hamburgerButton = document.getElementById('hamburger-button');
        const navMenu = document.getElementById('nav-menu');
        if (hamburgerButton && navMenu) {
            hamburgerButton.addEventListener('click', () => navMenu.classList.toggle('active'));
            navMenu.addEventListener('click', (e) => {
                if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') { // Close on link or button click
                    navMenu.classList.remove('active');
                }
            });
        }
        // Define debounce function
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func.apply(this, args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        // Search Input (uses debounce)
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(wrapHandler(() => {
                applyCurrentFiltersFromUI(); // Use new function on search input
            }, 'search input'), 300));
        }

        // User Identifier
        document.getElementById('userIdentifierInput')?.addEventListener('input', (event) => {
            updateUserIdentifier(event.target.value);
        });

        // Quick Actions & Header Buttons
        document.getElementById('start-new-count-btn')?.addEventListener('click', wrapAction(startNewCount, 'start new count'));
        document.getElementById('import-csv-btn')?.addEventListener('click', () => wrapAction(() => showImportDialog('update'), 'import CSV')()); // Ensure 'update' context for generic import
        document.getElementById('export-csv-btn')?.addEventListener('click', () => wrapAction(() => exportCSV(database.inventory), 'export CSV')());
        document.getElementById('export-pdf-btn')?.addEventListener('click', () => wrapAction(() => exportPDF(currentInventory), 'export PDF')()); // Export filtered data
        document.getElementById('finalize-inventory-btn')?.addEventListener('click', wrapAction(finalizeInventory, 'finalize inventory'));

        // Filters (Manual)
        document.getElementById('apply-filters-btn')?.addEventListener('click', wrapAction(applyCurrentFiltersFromUI, 'apply manual filters')); // Use new function for manual apply
        document.getElementById('clear-filters-btn')?.addEventListener('click', wrapAction(clearAllFilters, 'clear filters'));
        document.getElementById('locationFilterInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') wrapAction(applyCurrentFiltersFromUI, 'apply manual filters')(); // Use new function
        });
        document.getElementById('statusFilterSelect')?.addEventListener('change', wrapAction(applyCurrentFiltersFromUI, 'apply manual filters')); // Use new function

        // History View Toggles
        document.getElementById('view-history-link')?.addEventListener('click', (e) => {
            e.preventDefault();
            wrapAction(() => toggleHistoryView(true), 'show all history')();
        });
        document.getElementById('close-history-btn')?.addEventListener('click', () => {
            wrapAction(() => toggleHistoryView(false), 'hide all history')();
        });

        // Item History Modal Close Button
        document.getElementById('itemHistoryModalClose')?.addEventListener('click', wrapAction(closeItemHistoryModal, 'close item history modal'));
        document.getElementById('itemHistoryModal')?.addEventListener('click', (event) => {
            if (event.target === event.currentTarget) {
                wrapAction(closeItemHistoryModal, 'close item history modal')();
            }
        });

        // Event Delegation for Inventory List
        const inventoryListContainer = document.getElementById('inventoryList');
        if (inventoryListContainer) {
            inventoryListContainer.addEventListener('click', wrapHandler(handleInventoryListClick, 'inventory list click'));
            inventoryListContainer.addEventListener('change', wrapHandler(handleInventoryListChange, 'inventory list change'));
            inventoryListContainer.addEventListener('input', wrapHandler(handleInventoryListInput, 'inventory list input')); // For textarea notes
        } else {
            console.error("Inventory list container #inventoryList not found for delegation.");
        }

        // --- NEW: Event Delegation for Summary Cards ---
        const summaryCardsContainer = document.querySelector('.summary-cards');
        if (summaryCardsContainer) {
            summaryCardsContainer.addEventListener('click', wrapHandler(handleSummaryCardClick, 'summary card click'));
        } else {
            console.error("Summary cards container .summary-cards not found for delegation.");
        }


        console.log("Event listeners successfully set up.");
    } catch (error) {
        console.error("Error setting up event listeners:", error);
        alert("An error occurred while setting up UI interactions. Some buttons or actions might not work.");
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

// --- NEW Event Handler for Summary Cards ---
function handleSummaryCardClick(event) {
    const clickedCard = event.target.closest('.card');
    if (!clickedCard) return; // Click wasn't on a card or its descendant

    const cardId = clickedCard.id;
    console.log(`Summary card clicked: ${cardId}`);

    // Reset manual filters when using quick filters
    currentFilters.location = null;
    currentFilters.searchTerm = '';

    // Set filters based on card ID
    switch (cardId) {
        case 'total-items':
            currentFilters.status = 'all';
            currentFilters.filterByToCountStatus = 'all';
            break;
        case 'active-items':
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'all';
            break;
        case 'counted-items': // Shows 'finished' items for this cycle
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'counted'; // Items with toCount: false
            break;
        case 'uncounted-items': // Shows items 'to count' (default view)
            currentFilters.status = 'active';
            currentFilters.filterByToCountStatus = 'to_count'; // Items with toCount: true
            break;
        default:
            console.warn(`Unknown summary card ID clicked: ${cardId}`);
            return; // Do nothing if ID is unrecognized
    }

    // Update the UI filter controls to match the quick filter state
    updateFilterControlsUI();

    // Apply the filters and re-render
    applyCurrentFilters();
}

// --- NEW Helper to update UI filter controls ---
function updateFilterControlsUI() {
    const locationInput = document.getElementById('locationFilterInput');
    const statusSelect = document.getElementById('statusFilterSelect');
    const searchInput = document.getElementById('searchInput');

    if (locationInput) locationInput.value = currentFilters.location || '';
    if (statusSelect) statusSelect.value = currentFilters.status || 'all'; // Default to 'all' if status isn't set
    if (searchInput) searchInput.value = currentFilters.searchTerm || '';
}

// --- NEW: Renamed function specifically for applying filters from UI interactions ---
function applyCurrentFiltersFromUI() {
    // Read values from UI elements and update currentFilters state
    const locationInput = document.getElementById('locationFilterInput');
    const statusSelect = document.getElementById('statusFilterSelect');
    const searchInput = document.getElementById('searchInput');

    currentFilters.location = locationInput ? locationInput.value.trim().toLowerCase() : null;
    currentFilters.status = statusSelect ? statusSelect.value : 'active';
    currentFilters.searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : '';

    // When applying manual filters (location, status, search), generally reset the
    // view to the 'items to count' within that filter scope. If the user wants
    // 'finished' items within that scope, they'd use the card click first, then filter.
    // Exception: If 'All' status is selected, show all items (finished or not).
    if (currentFilters.status === 'all') {
        currentFilters.filterByToCountStatus = 'all';
    } else {
        currentFilters.filterByToCountStatus = 'to_count';
    }

    console.log("Applying filters from UI:", currentFilters);
    applyCurrentFilters(); // Call the core filter logic function
}



   // --- Replace the existing handleInventoryListClick function in appLogic.js with this version ---
function handleInventoryListClick(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId;

    console.log("[handleInventoryListClick] Click detected on itemDiv, itemId:", itemId); // DEBUG LOG
    console.log("[handleInventoryListClick] Clicked target element:", target); // DEBUG LOG

    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    // Helper function to find and trigger change on an input
    const applyValueToInput = (selector, value) => {
        const inputElement = itemDiv.querySelector(selector);
        if (inputElement && !inputElement.disabled) { // Allow populating readonly, but not disabled
             console.log(`Applying value '${value}' to input '${selector}' for item ${itemId}`);
             inputElement.value = value;
             console.log(`Dispatching 'change' event for input '${selector}'`);
             inputElement.dispatchEvent(new Event('change', { bubbles: true }));
             return true;
        } else if (!inputElement) {
             console.error(`Could not find input element with selector '${selector}' in item ${itemId}`);
             return false;
        } else {
             console.warn(`Input element '${selector}' is disabled. Cannot apply value.`);
             return false;
        }
    };

    if (target.matches('button[data-action="flag"]')) {
        console.log("[handleInventoryListClick] 'Flag' button matched.");
        flagUncounted(itemId);
    } else if (target.matches('button[data-action="view-history"]')) {
        console.log("[handleInventoryListClick] 'View History' button matched.");
        findInventoryItemByItemId(itemId).then(item => {
            const displaySku = item ? item.SKU : itemDiv.dataset.sku; // Use found item SKU first
            const displayDesc = item ? item.Description : 'Unknown Description';
            if (!itemId) {
                 console.error("Cannot show history: Item ID is missing.");
                 alert("Error: Could not identify the item to show history for.");
                 return;
            }
            console.log(`[handleInventoryListClick] Calling showItemHistory with ItemID: ${itemId} (SKU: ${displaySku})`);
            showItemHistory(itemId, displaySku, displayDesc);
        }).catch(err => {
            console.error(`Error finding item ${itemId} before showing history:`, err);
             alert("Error retrieving item details. Cannot show history.");
        });
    } else if (target.matches('span[data-action="apply-sequence"]')) {
        // ***** MODIFIED ***** Use helper function
        console.log("[handleInventoryListClick] 'Apply Sequence' span matched.");
        const sequenceType = target.dataset.sequenceType; // 'inner', 'outer', 'inner2', 'outer2'
        const sequenceValue = target.dataset.sequenceValue;
        if (sequenceType && sequenceValue !== undefined) {
             applyValueToInput(`input[data-sequence="${sequenceType}"]`, sequenceValue);
        } else {
            console.error("Missing sequence type or value on clicked span:", target);
        }
    } else if (target.matches('span[data-action="apply-expected-qty"]')) {
         // ***** ADDED ***** Handle click on expected quantity
         console.log("[handleInventoryListClick] 'Apply Expected Qty' span matched.");
         const expectedValue = target.dataset.value;
         if (expectedValue !== undefined) {
             applyValueToInput('input[data-type="count-input"]', expectedValue);
         } else {
              console.error("Missing expected quantity value on clicked span:", target);
         }
    } else if (target.matches('button[data-action="finalize-item"]')) {
        console.log("[handleInventoryListClick] 'Finalize Item' button matched.");
        wrapAction(() => finalizeSingleItem(itemId), `finalize item ${itemId}`)(); // Wrap the async function
    } else {
        // console.log("[handleInventoryListClick] No matching action button or span found for click target.");
    }
}
// --- End of handleInventoryListClick ---

async function finalizeSingleItem(itemId) {
    if (!itemId) {
        console.error("finalizeSingleItem: itemId is missing.");
        return;
    }
    console.log(`Attempting to finalize item: ${itemId}`);

    try {
        // 1. Get the item data (no need to recalculate sequence here, should be triggered by change event)
        const item = await findInventoryItemByItemId(itemId);
        if (!item) {
            console.error(`Item ${itemId} not found for finalization.`);
            alert(`Error: Could not find item ${itemId} to finalize.`);
            return;
        }
         // 1b. Validation Check: Can we finalize?
         if (!item.isActive) {
             console.warn(`Attempting to finalize inactive item ${itemId}.`);
             alert(`Cannot finalize an inactive item.`);
             return;
         }
         if (!item.toCount) {
             console.warn(`Item ${itemId} is not marked 'To Count'. Already finalized?`);
             // Optionally remove from view anyway? Or just do nothing? Let's do nothing.
             return;
         }
         // Check if count is valid (not null unless flagged, not NaN)
          if (item.counted === null && !item.isUncounted) {
             // This state shouldn't ideally happen if logic is correct, but check anyway
              console.error(`Item ${itemId} has null count but is not flagged uncounted. Cannot finalize.`);
              alert(`Error: Item ${item.SKU} has an invalid count state. Please flag as uncounted or enter a quantity.`);
              return;
          }
          if (typeof item.counted === 'number' && isNaN(item.counted)) {
               console.error(`Item ${itemId} has NaN count. Cannot finalize.`);
               alert(`Error: Item ${item.SKU} has an invalid quantity (NaN). Please correct.`);
               return;
          }
           // For Reels: If sequences were entered but invalid (calculatedFootage is null), prevent finalize?
           // Or allow finalizing with the last known valid 'counted' value?
           // Let's allow finalize if 'counted' itself is valid, even if sequences are currently bad.
           // The user might have manually corrected 'counted'.


        // 3. Mark as no longer needing count for this cycle
        item.toCount = false;
        const finalizedCount = item.counted; // Get the final count
        const wasUncounted = item.isUncounted; // Capture state before finalize potentially sets it

        // 4. Log the finalization event for this specific item
        logTransaction({
            type: 'item_count_finalized',
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            user: getUserIdentifier(), // Added user
            timestamp: new Date().toISOString(), // Added timestamp
            details: {
                finalCount: finalizedCount, // Could be null if flagged uncounted
                wasUncountedAtFinalize: wasUncounted,
                sequences: { // Log the sequences as they were when finalized
                    inner1: item.innerSequence, outer1: item.outerSequence,
                    inner2: item.innerSequence2, outer2: item.outerSequence2
                },
                notes: item.notes // Log notes at time of finalization
            }
        });

        // 5. Save the change (toCount = false)
        await autoSave();
        console.log(`Item ${itemId} marked as finished for this count cycle.`);

        // 6. Update UI
        applyCurrentFilters(); // Re-filter and render the list (item should disappear from 'to_count' view)
        updateSummaryCards(); // Update summary counts

    } catch (error) {
        console.error(`Error finalizing item ${itemId}:`, error);
        alert(`An error occurred while finalizing item ${itemId}. Please check the console.`);
        // Attempt to re-render to reflect any partial state changes?
        applyCurrentFilters();
    }
}


function handleInventoryListChange(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId; // <-- GET itemId

    // Add a check to ensure itemId was found
    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    if (target.matches('input[data-type="count-input"]:not(:disabled):not([readonly])')) {
        updateCount(itemId, target.value); // <-- PASS itemId
    } else if (target.matches('input[data-sequence]:not(:disabled)')) { // Matches inner, outer, inner2, outer2
        updateSequences(itemId); // <-- PASS itemId
    } else if (target.matches('textarea[data-type="notes-input"]:not(:disabled)')) { // <-- Use 'change' for notes
        updateItemNotes(itemId, target.value); // <-- PASS itemId
    }
}

// handleInventoryListInput is no longer needed for notes if using 'change' event
function handleInventoryListInput(event) {
    // Potentially handle other 'input' events here if needed in the future
    // For now, it can be empty or removed if only notes were using it.
    // console.log("Input event triggered:", event.target);
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



// --- State Update Helper ---
// MODIFIED Core filter logic function
// Now applies filters based on the currentFilters state object,
// which can be set by UI interaction OR card clicks.
function applyCurrentFilters() {
    try {
        console.log("Applying filters:", currentFilters);

        // --- Primary Filtering (Location, Status, ToCountStatus) ---
        let filteredInventory = database.inventory.filter(item => {
            // Location Filter
            const locationMatch = !currentFilters.location || (item.location && item.location.toLowerCase().includes(currentFilters.location));

            // Status Filter (isActive property)
            const statusMatch = currentFilters.status === 'all' ||
                                (currentFilters.status === 'active' && item.isActive) ||
                                (currentFilters.status === 'inactive' && !item.isActive);

            // ToCount Filter (based on filterByToCountStatus)
            let toCountMatch = false;
            switch (currentFilters.filterByToCountStatus) {
                case 'all':
                    toCountMatch = true; // Show all regardless of toCount flag
                    break;
                case 'counted': // Show 'finished' items (toCount is false)
                    toCountMatch = item.toCount === false;
                    break;
                case 'to_count': // Show items marked 'to count' (toCount is true) - default
                default:
                    toCountMatch = item.toCount === true;
                    break;
            }

            return locationMatch && statusMatch && toCountMatch;
        });

        // --- Secondary Filtering (Search Term) ---
        if (currentFilters.searchTerm) {
            const searchTermLower = currentFilters.searchTerm.toLowerCase();
            filteredInventory = filteredInventory.filter(item => {
                const skuMatch = item.SKU && item.SKU.toLowerCase().includes(searchTermLower);
                const descMatch = item.Description && item.Description.toLowerCase().includes(searchTermLower);
                const reelNumMatch = item.reelNumber && item.reelNumber.toLowerCase().includes(searchTermLower);
                // Add itemId match?
                const itemIdMatch = item.itemId && item.itemId.toLowerCase().includes(searchTermLower);
                return skuMatch || descMatch || reelNumMatch || itemIdMatch;
            });
            console.log(`Applied search term "${currentFilters.searchTerm}", ${filteredInventory.length} items remain.`);
        }

        // Assign to currentInventory and sort
        currentInventory = filteredInventory;
        currentInventory.sort((a, b) => {
            // Primary sort by location, secondary by SKU
             const locA = a.location || '';
             const locB = b.location || '';
             const skuA = a.SKU || '';
             const skuB = b.SKU || '';
             if (locA < locB) return -1;
             if (locA > locB) return 1;
             // Locations are same, sort by SKU
             if (skuA < skuB) return -1;
             if (skuA > skuB) return 1;
             return 0;
        });

        // Re-render the list
        renderInventoryList();
        // Summary cards are updated separately, often after data changes,
        // but maybe call it here too for consistency after filtering?
        // updateSummaryCards(); // Let's keep this where data actually changes.

    } catch (error) {
        console.error("Error applying filters:", error);
        currentInventory = []; // Fallback to empty on error
        renderInventoryList(); // Render the empty state or error message
    }
}

// --- MODIFIED clearAllFilters ---
function clearAllFilters() {
    // Reset filter state to defaults
    currentFilters.location = null;
    currentFilters.status = 'active'; // Default status
    currentFilters.searchTerm = '';
    currentFilters.filterByToCountStatus = 'to_count'; // Default count status view

    // Update UI elements to reflect cleared state
    updateFilterControlsUI();

    // Re-apply default filters and render
    applyCurrentFilters();
}


// --- Core Logic Functions ---

// --- Core Data Access (Refactored for itemId) ---

// Finds a specific item-location record by its unique ID
async function findInventoryItemByItemId(itemId) {
    if (!itemId) {
        console.warn("findInventoryItemByItemId called with null or undefined itemId.");
        return null;
    }
    // In-memory find is usually sufficient as 'database.inventory' should be up-to-date
    const item = database.inventory.find(item => item.itemId === itemId);
    // Add a check against DB only if necessary or for debugging staleness issues
    // if (!item) { console.warn(`Item ${itemId} not in memory. Checking DB...`); /* DB lookup? */ }
    return item || null;
}

// Finds all item-location records for a given SKU (less common now with itemId)
function findInventoryItemsBySKU(sku) {
    if (sku === null || sku === undefined) {
        console.warn("findInventoryItemsBySKU called with null or undefined SKU.");
        return [];
    }
    const searchSKU = String(sku).trim();
     if (!searchSKU) {
        console.warn("findInventoryItemsBySKU called with empty SKU.");
        return [];
    }
    return database.inventory.filter(item => String(item.SKU).trim() === searchSKU);
}

// Finds a specific item by non-reel SKU + location combo OR by reel number
// Used primarily during CSV import to match incoming rows to existing DB records.
function findExistingItemRecord(sku, location = null, reelNumber = null) {
     if (!sku) return null;
     const searchSKU = String(sku).trim();
     const searchLoc = location ? String(location).trim().toLowerCase() : null;
     const searchReel = reelNumber ? String(reelNumber).trim() : null;

     if (searchReel) {
         // Reels are uniquely identified by reelNumber (assumption)
         const found = database.inventory.find(item => item.isReel && item.reelNumber === searchReel);
         // console.log(`findExistingItemRecord (Reel: ${searchReel}): Found?`, !!found);
         return found;
     } else if (searchLoc) {
         // Non-reels are unique by SKU + Location
         const found = database.inventory.find(item =>
             !item.isReel && // Important: only match non-reels this way
             String(item.SKU).trim() === searchSKU &&
             String(item.location).trim().toLowerCase() === searchLoc
         );
         // console.log(`findExistingItemRecord (SKU: ${searchSKU}, Loc: ${searchLoc}): Found?`, !!found);
         return found;
     } else {
          console.warn(`findExistingItemRecord called for SKU ${searchSKU} without location or reelNumber. Cannot reliably find unique item.`);
          return null; // Cannot reliably find a unique non-reel without location
     }
}

// --- Core Data Modification (Refactored for itemId) ---

// Records the physical count OR updates count via adjustment, logs, saves
async function recordOrUpdateCount(itemId, newQuantity, source, details = {}) {
    // source: 'manual_count', 'sequence_calc', 'recount_adjustment', 'import_update'
    // details: object containing relevant info like old value, notes, adjustmentTxId, etc.
    if (itemId === null || itemId === undefined) {
        console.error("recordOrUpdateCount: itemId is missing.");
        return null;
    }
    if (newQuantity === null || newQuantity === undefined || typeof newQuantity !== 'number' || isNaN(newQuantity) || newQuantity < 0) {
        console.error(`recordOrUpdateCount: Invalid newQuantity (${newQuantity}) for itemId ${itemId}.`);
        return null; // Reject invalid quantity
    }

    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) {
            console.error(`Item with itemId ${itemId} not found for recording count.`);
            return null;
        }
        // Don't allow updates on inactive items (except potentially reactivation?)
        if (!item.isActive) {
            console.warn(`Attempted to update count for inactive item ${itemId} (SKU: ${item.SKU}, Loc: ${item.location}).`);
            return null;
        }
        // Don't allow direct count updates on items finished for the cycle (use adjustments or new cycle)
         if (!item.toCount && source !== 'recount_adjustment') {
             console.warn(`Attempted to update count for finished item ${itemId} (source: ${source}). Use adjustment or start new cycle.`);
             // Optionally provide feedback to user?
             // alert(`Item ${item.SKU} at ${item.location} is already finished for this cycle. Count not updated.`);
             return null;
         }


        const previousCount = item.counted;
        const previousFlag = item.isUncounted;
        const isCurrentlyRecount = item.currentRecountBatchId !== null;

        // No change needed if quantity is identical AND state isn't changing from uncounted
        if (previousCount === newQuantity && previousFlag === false && source !== 'recount_adjustment') {
            // Still allow recount adjustments even if quantity doesn't change overall count
            console.log(`Count for ${itemId} is already ${newQuantity}. No change recorded (source: ${source}).`);
            return item; // Return the item, but indicate no change was made
        }

        // Update item state
        item.counted = newQuantity;
        item.isUncounted = false; // Explicitly has a count value now
        item.lastCountTimestamp = new Date().toISOString();
        // If the update source was sequence calculation, store that result
        if (source === 'sequence_calc') {
            item.calculatedFootage = newQuantity;
        } else if (source !== 'recount_adjustment') {
            // Clear calculated footage if manually counted or imported without sequences
            item.calculatedFootage = null;
        }

        // Log the transaction
        const logEntry = {
            type: 'update_count', // Default type
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            user: getUserIdentifier(),
            timestamp: item.lastCountTimestamp,
            details: {
                source: source,
                oldValue: previousCount,
                newValue: newQuantity,
                wasUncounted: previousFlag,
                ...details // Add any source-specific details
            }
        };

        // Adjust log type if it's part of a recount
        if (isCurrentlyRecount) {
            logEntry.type = source === 'recount_adjustment' ? 'recount_adjustment_update' : 'recount_physical_update';
            logEntry.details.recountBatchId = item.currentRecountBatchId;
        }

        try {
            await logTransaction(logEntry); // Use the unified logging function
            console.log(`Recorded count change for ${item.itemId} (SKU: ${item.SKU}, Loc: ${item.location}): ${previousCount} -> ${newQuantity}. Source: ${source}`);
        } catch (logError) {
            console.error(`Failed to log transaction for ${item.itemId}:`, logError);
            // Continue with auto-save even if logging fails? Yes, state is updated.
        }

        // Trigger autosave (no need to await here unless critical)
        autoSave().catch(e => console.error("Autosave failed after recording count:", e));

        return item; // Return the updated item object

    } catch (error) {
        console.error(`Error in recordOrUpdateCount for itemId ${itemId}:`, error);
        return null;
    }
}

// Flags an item-location as uncounted
async function flagUncounted(itemId) {
    if (!itemId) { console.error("flagUncounted: itemId is missing."); return; }
    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) { console.error(`Item ${itemId} not found for flagging.`); return; }
        if (!item.isActive) { console.warn(`Attempted to flag inactive item ${itemId}.`); return; }
        // Cannot flag if not marked 'toCount'
        if (!item.toCount) { console.warn(`Attempted to flag finished item ${itemId}.`); return; }
        if (item.isUncounted === true && item.counted === null) { console.log(`Item ${itemId} already flagged.`); return; } // No change needed

        const previousState = { counted: item.counted, isUncounted: item.isUncounted };
        const timestamp = new Date().toISOString();

        item.isUncounted = true;
        item.counted = null;
        item.lastCountTimestamp = timestamp;
        // Clear sequences/calculated footage when flagged
        item.innerSequence = ''; item.outerSequence = '';
        item.innerSequence2 = ''; item.outerSequence2 = '';
        item.calculatedFootage = null;

        // Log transaction
        const logEntry = {
            type: 'flag_uncounted',
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            user: getUserIdentifier(),
            timestamp: timestamp,
            details: { previousState: previousState }
        };
        // Add recount info if applicable
        if (item.currentRecountBatchId) {
            logEntry.type = 'recount_flag_uncounted';
            logEntry.details.recountBatchId = item.currentRecountBatchId;
        }

        try {
            await logTransaction(logEntry); // Use unified logging
            console.log(`Flagged ${item.itemId} (SKU: ${item.SKU}, Loc: ${item.location}) as uncounted.`);
        } catch (logError) {
             console.error(`Failed to log flag_uncounted for ${item.itemId}:`, logError);
        }

        // Trigger UI update and save
        autoSave().catch(e => console.error("Autosave failed after flagging:", e));
        applyCurrentFilters(); // Re-apply filters which triggers re-render
        updateSummaryCards(); // Update summary

    } catch (error) {
        console.error(`Error in flagUncounted for itemId ${itemId}:`, error);
        alert(`Failed to flag item ${item?.SKU || itemId}. See console.`);
    }
}



    // --- Replace the existing updateCount function in appLogic.js with this version ---
async function updateCount(itemId, quantityStr) {
    const quantity = Number(quantityStr);
    if (isNaN(quantity) || quantity < 0) {
        alert("Invalid quantity entered. Please enter a non-negative number.");
        // Find the input and reset it visually without a full re-render if possible
        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        const inputElement = itemDiv?.querySelector('input[data-type="count-input"]');
        if (inputElement) {
            // Try to reset to the last known valid value from the database
            findInventoryItemByItemId(itemId).then(item => {
                if (item) {
                    inputElement.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
                }
            });
        }
        return;
    }

    /* Removed: The call to applyCurrentFilters(); has been removed to prevent the full UI refresh.
Added: An explicit call to autoSave().catch(...) was added within the success condition to ensure the save is triggered after the update.
Modified: Added logic to attempt resetting the input field's visual value directly using DOM manipulation if an invalid number is entered or if recordOrUpdateCount fails, avoiding a full re-render just for reset. */
    // Use recordOrUpdateCount for logging/saving
    const updatedItem = await recordOrUpdateCount(itemId, quantity, 'manual_count');

    if (updatedItem) {
        // applyCurrentFilters(); // ***** REMOVED ***** - Prevent full re-render
        updateSummaryCards(); // Summary cards can still update
        autoSave().catch(e => console.error("Autosave failed after updating count:", e)); // ***** ADDED ***** Ensure save is triggered
        console.log(`Count updated for ${itemId} to ${quantity}, background save triggered.`);
    } else {
        // Handle case where recordCount failed (already logged error, or was prevented)
        console.warn(`Update count for ${itemId} did not result in a saved change or was disallowed.`);
         // Optionally reset input visually if update failed
         const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
         const inputElement = itemDiv?.querySelector('input[data-type="count-input"]');
         if (inputElement) {
            findInventoryItemByItemId(itemId).then(item => {
                 if (item) {
                     inputElement.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
                 }
            });
         }
    }
}


function calculateFootageForItem(item, sequences) {
    // sequences = { inner1, outer1, inner2, outer2 }
    console.log(`[calculateFootageForItem] Called for itemId: ${item?.itemId}, sequences:`, sequences); // Log entry

    if (!item || !item.isReel) {
        console.log(`[calculateFootageForItem] Not a reel or item missing.`);
        return null; // Not a reel
    }

    let anyInputEntered = false;
    let errorPresent = false;

    // Helper to parse, treating blank as 0, checking for validity
    const parseSequence = (valueStr) => {
        const trimmedStr = String(valueStr || '').trim(); // Ensure it's a string and trim

        if (trimmedStr === '') {
            return 0; // Treat blank as 0
        }

        anyInputEntered = true; // Mark that at least one field has content

        const num = Number(trimmedStr);

        if (isNaN(num) || num < 0) {
             console.warn(`[calculateFootageForItem] Invalid sequence value detected: '${trimmedStr}' for itemId ${item.itemId}`);
             errorPresent = true;
             return null; // Return null to indicate error for this value
        }
        return num; // Return the valid, non-negative number
    };

    // Parse all sequence values
    const parsed_inner1 = parseSequence(sequences.inner1);
    const parsed_outer1 = parseSequence(sequences.outer1);
    const parsed_inner2 = parseSequence(sequences.inner2);
    const parsed_outer2 = parseSequence(sequences.outer2);

    // If any invalid non-blank value was entered, calculation is invalid
    if (errorPresent) {
         console.log(`[calculateFootageForItem] Invalid input detected. Returning null.`);
         return null;
    }

    // If no fields had any input, return null (no calculation needed/possible)
    if (!anyInputEntered) {
         console.log(`[calculateFootageForItem] No sequences entered. Returning null.`);
         return null;
    }

    // Calculate difference for pair 1
    const diff1 = Math.abs(parsed_outer1 - parsed_inner1);
    console.log(`[calculateFootageForItem] Pair 1: inner=${parsed_inner1}, outer=${parsed_outer1}, diff1=${diff1}`);

    // Calculate difference for pair 2 (only if two-way reel)
    let diff2 = 0;
    if (item.isTwoWayReel) {
        diff2 = Math.abs(parsed_outer2 - parsed_inner2);
        console.log(`[calculateFootageForItem] Pair 2 (Two-Way): inner=${parsed_inner2}, outer=${parsed_outer2}, diff2=${diff2}`);
    } else {
        console.log(`[calculateFootageForItem] Not a two-way reel, diff2=0.`);
    }

    // Calculate total quantity
    const totalQty = diff1 + diff2;
    console.log(`[calculateFootageForItem] Calculated Total Qty: ${totalQty}`);

    // Return the calculated total quantity (which might be 0 if differences cancel out or inputs were 0)
    return totalQty;

}
async function updateSequences(itemId) {
    if (!itemId) { console.error("updateSequences: itemId missing"); return; }
    let item = null; // Define item variable in the outer scope

    try {
        item = await findInventoryItemByItemId(itemId); // Assign to outer scope variable
        if (!item || !item.isActive || !item.isReel || !item.toCount) {
            console.warn(`Cannot update sequences: Item ${itemId} not found, inactive, not a reel, or already finished.`);
            // Reset inputs visually if needed, without full re-render
             const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
             if (itemDiv && item) { // Check if item exists before accessing properties
                 itemDiv.querySelector('input[data-sequence="inner"]').value = item.innerSequence ?? '';
                 itemDiv.querySelector('input[data-sequence="outer"]').value = item.outerSequence ?? '';
                 if(item.isTwoWayReel) {
                     itemDiv.querySelector('input[data-sequence="inner2"]').value = item.innerSequence2 ?? '';
                     itemDiv.querySelector('input[data-sequence="outer2"]').value = item.outerSequence2 ?? '';
                 }
             }
            // applyCurrentFilters(); // ***** REMOVED *****
            return;
        }

        // Find the specific item's div in the DOM to get input values AND to update later
        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        if (!itemDiv) {
             console.error(`Could not find item div for itemId ${itemId} to read/update sequence inputs.`);
             return; // Cannot proceed without the UI elements
        }

         // Get sequence values directly from the inputs within this item's div
         const sequenceValues = {
            inner1: itemDiv.querySelector('input[data-sequence="inner"]')?.value ?? '',
            outer1: itemDiv.querySelector('input[data-sequence="outer"]')?.value ?? '',
            inner2: itemDiv.querySelector('input[data-sequence="inner2"]')?.value ?? '',
            outer2: itemDiv.querySelector('input[data-sequence="outer2"]')?.value ?? '',
         };

        // Store raw input values in the item model
        item.innerSequence = sequenceValues.inner1;
        item.outerSequence = sequenceValues.outer1;
        if (item.isTwoWayReel) {
            item.innerSequence2 = sequenceValues.inner2;
            item.outerSequence2 = sequenceValues.outer2;
        } else {
            item.innerSequence2 = ''; item.outerSequence2 = ''; // Clear second pair if not two-way
        }

        // Calculate footage based on the *updated* sequences
        const calculatedFootage = calculateFootageForItem(item, sequenceValues); // Pass item and sequences
        const previousCalculatedFootage = item.calculatedFootage; // Store previous for comparison
        item.calculatedFootage = calculatedFootage; // Update model regardless of validity for UI

        let countUpdated = false;
        // Update the main count only if calculation is valid
        if (calculatedFootage !== null) {
            const updatedItemResult = await recordOrUpdateCount(itemId, calculatedFootage, 'sequence_calc', {
                 sequences: sequenceValues // Log the sequences used
            });
            if (updatedItemResult) {
                countUpdated = true; // Mark that the count was successfully updated via recordOrUpdateCount
                console.log(`Sequence calculation successful for ${itemId}, count updated to ${calculatedFootage}.`);
            } else {
                 console.warn(`Sequence calculation successful for ${itemId}, but count update failed or was disallowed (e.g., item finished).`);
                 // Count wasn't updated, but sequences were. Ensure save happens.
            }
        } else {
            // Calculation invalid or no sequences entered
             console.log(`Sequences updated for ${itemId}, but calculation invalid or incomplete. Saving sequence data only.`);
             // If calculation is invalid, should we clear the main 'counted' field or leave it?
             // Leave the main 'counted' field as it was previously. The user must explicitly flag or enter 0.
        }

        // ***** ADDED: Direct DOM Manipulation *****
        // Update the UI elements directly without a full re-render
        const countInput = itemDiv.querySelector('input[data-type="count-input"]');
        const totalFootageDisplay = itemDiv.querySelector('.calculated-footage-display.total-footage');

        if (countInput && totalFootageDisplay) {
            if (calculatedFootage !== null) {
                // Update count input value and disable it
                countInput.value = calculatedFootage;
                countInput.disabled = true; // Disable manual count when calculated
                countInput.readOnly = false; // Ensure not readonly if it became valid calc
                countInput.title = "Quantity calculated from footage"; // Update tooltip

                // Update footage display span
                totalFootageDisplay.textContent = `Total: ${calculatedFootage.toFixed(2)} ft`;
                totalFootageDisplay.style.color = ''; // Reset color
                totalFootageDisplay.title = ''; // Clear title if it was invalid
            } else {
                // Calculation invalid or no valid sequences entered
                // Re-enable count input if it was disabled *by calculation*
                // But only if the item is active and toCount (i.e., editable)
                const allowManualInput = item.isActive && item.toCount;
                countInput.disabled = !allowManualInput; // Re-enable if appropriate
                countInput.readOnly = !allowManualInput; // Make readonly if finished/inactive
                countInput.title = allowManualInput ? "" : (item.isActive ? "Item finished for this cycle (view only)" : "Item is inactive");

                 // Update footage display span to show invalid state
                 const hasPartialSequenceInput = sequenceValues.inner1 || sequenceValues.outer1 || (item.isTwoWayReel && (sequenceValues.inner2 || sequenceValues.outer2));
                 if (hasPartialSequenceInput) {
                    totalFootageDisplay.textContent = 'Total: Invalid';
                    totalFootageDisplay.style.color = 'var(--danger-color)';
                    totalFootageDisplay.title = 'Incomplete or invalid sequence values entered.';
                 } else {
                      totalFootageDisplay.textContent = 'Total: ---';
                      totalFootageDisplay.style.color = '';
                      totalFootageDisplay.title = '';
                 }

                 // If calculation became invalid, reset item.calculatedFootage to null explicitly
                 // This was already done above, but double-check
                 if(item.calculatedFootage !== null) item.calculatedFootage = null;

                 // Should we reset the countInput.value if calculation becomes invalid?
                 // No, let's keep the last valid value (either manual or calculated).
                 // The user needs to explicitly change it or flag it.
            }
        } else {
             console.error(`Could not find count input or footage display for item ${itemId} during DOM update.`);
        }
        // ***** END: Direct DOM Manipulation *****


        // Trigger autosave regardless of whether count was updated (saves sequence changes)
        autoSave().catch(e => console.error("Autosave failed after updating sequences:", e));
        console.log(`Sequences updated for ${itemId}, background save triggered.`);

        // Re-render needed ONLY if count/status changed in a way that affects filters? No, avoid.
        // applyCurrentFilters(); // ***** REMOVED *****
        updateSummaryCards(); // Update summary cards as count might have changed

    } catch (error) {
        console.error(`Error updating sequences for itemId ${itemId}:`, error);
        alert(`Failed to update sequences for ${item?.SKU || itemId}. See console.`);
        // Attempt to reset sequence inputs visually on error without full re-render
         const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
         if (itemDiv && item) { // Use the item variable from the outer scope
            itemDiv.querySelector('input[data-sequence="inner"]').value = item.innerSequence ?? '';
            itemDiv.querySelector('input[data-sequence="outer"]').value = item.outerSequence ?? '';
            if(item.isTwoWayReel) {
                itemDiv.querySelector('input[data-sequence="inner2"]').value = item.innerSequence2 ?? '';
                itemDiv.querySelector('input[data-sequence="outer2"]').value = item.outerSequence2 ?? '';
            }
            // Also reset calculated display and count input state
             const countInput = itemDiv.querySelector('input[data-type="count-input"]');
             const totalFootageDisplay = itemDiv.querySelector('.calculated-footage-display.total-footage');
             if (countInput) {
                 countInput.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
                 countInput.disabled = !item.isActive || !item.toCount || (item.calculatedFootage !== null); // Reset based on last known good state
                 countInput.readOnly = !item.isActive || !item.toCount;
                 countInput.title = !item.isActive ? "Item is inactive" : !item.toCount ? "Item finished for cycle (view only)" : (item.calculatedFootage !== null ? "Quantity calculated from footage" : "");
             }
             if (totalFootageDisplay) {
                 totalFootageDisplay.textContent = (item.calculatedFootage !== null) ? `Total: ${item.calculatedFootage.toFixed(2)} ft` : 'Total: ---';
                 totalFootageDisplay.style.color = '';
                 totalFootageDisplay.title = '';
             }
         }
        // applyCurrentFilters(); // ***** REMOVED *****
    }
}

/*
Added Logging: Included more console.log statements to trace execution flow and values.
DOM Update Fix: The core logic for updating countInput.value = calculatedFootage when calculatedFootage !== null was already present. The issue might have been subtle or related to timing/event propagation elsewhere. The key change here is the verification that this line is being executed and the surrounding logic for disabling/enabling the input is correct. Explicitly setting countInput.readOnly = false when calculated ensures it's not inadvertently left readonly. The addition of more logging helps confirm this section runs as expected.
DOM Reset Logic: Improved the visual reset logic in the catch block and the initial check (!item || !item.isActive || !item.toCount) to correctly reflect the item.toCount state (blank inputs if true).
*/
// --- Replace the existing updateSequences function in appLogic.js with this version ---
async function updateSequences(itemId) {
    if (!itemId) { console.error("updateSequences: itemId missing"); return; }
    console.log(`[updateSequences] Triggered for itemId: ${itemId}`); // Add entry log
    let item = null; // Define item variable in the outer scope

    try {
        item = await findInventoryItemByItemId(itemId); // Assign to outer scope variable
        if (!item || !item.isActive || !item.toCount) {
             console.warn(`Cannot update sequences: Item ${itemId} not found, inactive, or already finished.`);
             // Visually reset inputs if needed, without full re-render
             const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
             if (itemDiv && item) {
                 itemDiv.querySelector('input[data-sequence="inner"]').value = item.toCount ? '' : item.innerSequence ?? '';
                 itemDiv.querySelector('input[data-sequence="outer"]').value = item.toCount ? '' : item.outerSequence ?? '';
                 if (item.isTwoWayReel) {
                     itemDiv.querySelector('input[data-sequence="inner2"]').value = item.toCount ? '' : item.innerSequence2 ?? '';
                     itemDiv.querySelector('input[data-sequence="outer2"]').value = item.toCount ? '' : item.outerSequence2 ?? '';
                 }
             }
            return;
        }

        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        if (!itemDiv) {
             console.error(`Could not find item div for itemId ${itemId} to read/update sequence inputs.`);
             return;
        }

         // Get sequence values directly from the inputs
         const sequenceValues = {
            inner1: itemDiv.querySelector('input[data-sequence="inner"]')?.value ?? '',
            outer1: itemDiv.querySelector('input[data-sequence="outer"]')?.value ?? '',
            inner2: itemDiv.querySelector('input[data-sequence="inner2"]')?.value ?? '',
            outer2: itemDiv.querySelector('input[data-sequence="outer2"]')?.value ?? '',
         };
         console.log(`[updateSequences] Read sequence values from inputs:`, sequenceValues);

        // Store raw input values in the item model
        item.innerSequence = sequenceValues.inner1;
        item.outerSequence = sequenceValues.outer1;
        if (item.isTwoWayReel) {
            item.innerSequence2 = sequenceValues.inner2;
            item.outerSequence2 = sequenceValues.outer2;
        } else {
            item.innerSequence2 = ''; item.outerSequence2 = '';
        }

        // Calculate footage based on the updated sequences
        const calculatedFootage = calculateFootageForItem(item, sequenceValues);
        item.calculatedFootage = calculatedFootage; // Update model's calculation result
        console.log(`[updateSequences] Calculated footage: ${calculatedFootage}`);

        let countUpdated = false;
        // Update the main count only if calculation is valid
        if (calculatedFootage !== null) {
            console.log(`[updateSequences] Valid calculation. Calling recordOrUpdateCount with ${calculatedFootage}`);
            const updatedItemResult = await recordOrUpdateCount(itemId, calculatedFootage, 'sequence_calc', {
                 sequences: sequenceValues // Log the sequences used
            });
            if (updatedItemResult) {
                countUpdated = true;
                console.log(`[updateSequences] recordOrUpdateCount successful. Item count updated in model to ${calculatedFootage}.`);
            } else {
                 console.warn(`[updateSequences] Sequence calculation successful, but recordOrUpdateCount failed or was disallowed (e.g., item finished).`);
            }
        } else {
            console.log(`[updateSequences] Calculation invalid or incomplete. Saving sequence data only.`);
            // Leave main 'counted' field as is. User must explicitly flag or enter 0.
        }

        // ***** MODIFIED: Direct DOM Manipulation *****
        const countInput = itemDiv.querySelector('input[data-type="count-input"]');
        const totalFootageDisplay = itemDiv.querySelector('.calculated-footage-display.total-footage');

        if (countInput && totalFootageDisplay) {
            console.log(`[updateSequences] Updating DOM elements directly...`);
            if (calculatedFootage !== null) {
                // --- Update count input value and disable it ---
                console.log(`[updateSequences] Setting countInput value to ${calculatedFootage} and disabling.`);
                countInput.value = calculatedFootage; // ***** KEY FIX: Ensure this updates visually *****
                countInput.disabled = true; // Disable manual count when calculated
                countInput.readOnly = false; // Ensure not readonly if it became valid calc
                countInput.title = "Quantity calculated from footage";

                // --- Update footage display span ---
                totalFootageDisplay.textContent = `Total: ${calculatedFootage.toFixed(2)} ft`;
                totalFootageDisplay.style.color = '';
                totalFootageDisplay.title = '';
            } else {
                // --- Calculation invalid or no valid sequences entered ---
                // Re-enable count input if it was disabled *by calculation*
                const allowManualInput = item.isActive && item.toCount;
                console.log(`[updateSequences] Invalid calculation. Setting countInput disabled: ${!allowManualInput}`);
                countInput.disabled = !allowManualInput;
                countInput.readOnly = !allowManualInput; // Readonly if finished/inactive
                countInput.title = allowManualInput ? "Enter current count" : (item.isActive ? "Item finished for this cycle (view only)" : "Item is inactive");

                // --- Update footage display span to show invalid state ---
                const hasPartialSequenceInput = sequenceValues.inner1 || sequenceValues.outer1 || (item.isTwoWayReel && (sequenceValues.inner2 || sequenceValues.outer2));
                 if (hasPartialSequenceInput) {
                    totalFootageDisplay.textContent = 'Total: Invalid';
                    totalFootageDisplay.style.color = 'var(--danger-color)';
                    totalFootageDisplay.title = 'Incomplete or invalid sequence values entered.';
                 } else {
                    totalFootageDisplay.textContent = 'Total: ---';
                    totalFootageDisplay.style.color = '';
                    totalFootageDisplay.title = '';
                 }
                 // Leave the countInput.value as it was (user must explicitly clear/flag)
            }
            console.log(`[updateSequences] DOM updates applied for count input and footage display.`);
        } else {
             console.error(`[updateSequences] Could not find count input or footage display for item ${itemId} during DOM update.`);
        }
        // ***** END: Direct DOM Manipulation *****

        // Trigger autosave regardless (saves sequence changes even if count didn't update)
        autoSave().catch(e => console.error("Autosave failed after updating sequences:", e));
        console.log(`[updateSequences] Sequences updated for ${itemId}, background save triggered.`);

        // No full re-render needed. Update summary cards as count might have changed.
        updateSummaryCards();

    } catch (error) {
        console.error(`Error updating sequences for itemId ${itemId}:`, error);
        alert(`Failed to update sequences for ${item?.SKU || itemId}. See console.`);
        // Attempt to reset sequence inputs visually on error without full re-render
         const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
         if (itemDiv && item) {
             itemDiv.querySelector('input[data-sequence="inner"]').value = item.toCount ? '' : item.innerSequence ?? '';
             itemDiv.querySelector('input[data-sequence="outer"]').value = item.toCount ? '' : item.outerSequence ?? '';
             if (item.isTwoWayReel) {
                 itemDiv.querySelector('input[data-sequence="inner2"]').value = item.toCount ? '' : item.innerSequence2 ?? '';
                 itemDiv.querySelector('input[data-sequence="outer2"]').value = item.toCount ? '' : item.outerSequence2 ?? '';
             }
            // Also reset calculated display and count input state based on last known *good* state (item object)
             const countInput = itemDiv.querySelector('input[data-type="count-input"]');
             const totalFootageDisplay = itemDiv.querySelector('.calculated-footage-display.total-footage');
             if (countInput) {
                  // Reset count input based on item's last known state
                 countInput.value = item.toCount ? '' : (item.counted === null || item.counted === undefined) ? '' : item.counted;
                 const isCalculated = item.isReel && item.footageFactor > 0 && item.calculatedFootage !== null;
                 countInput.disabled = !item.isActive || isCalculated;
                 countInput.readOnly = !item.isActive || !item.toCount;
                 countInput.title = !item.isActive ? "Item is inactive" : isCalculated ? "Quantity calculated from footage" : !item.toCount ? "Item finished for cycle (view only)" : "Enter current count";
             }
             if (totalFootageDisplay) {
                 totalFootageDisplay.textContent = (item.calculatedFootage !== null) ? `Total: ${item.calculatedFootage.toFixed(2)} ft` : 'Total: ---';
                 totalFootageDisplay.style.color = '';
                 totalFootageDisplay.title = '';
             }
         }
    }
}
// --- End of updateSequences ---


async function updateItemNotes(itemId, notes) {
    if (!itemId) { console.error("updateItemNotes: itemId missing"); return; }
    try {
        const item = await findInventoryItemByItemId(itemId);
        // Allow updating notes even if inactive? Yes. But not if finished? Yes.
        // Allow notes update even if finished for the cycle.
        if (!item /*|| !item.isActive || !item.toCount*/) { // Removed checks preventing notes on finished/inactive items
             console.warn(`Cannot update notes: Item ${itemId} not found.`);
             // Re-render to reset textarea if needed? No, avoid re-render.
             // applyCurrentFilters(); // ***** REMOVED *****
             // Reset textarea manually if needed
             const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
             const textarea = itemDiv?.querySelector('textarea[data-type="notes-input"]');
             if(textarea && item) textarea.value = item.notes ?? ''; // Reset to DB value
            return;
        }

        if (item.notes !== notes) {
            const oldNotes = item.notes;
            item.notes = notes;
            const timestamp = new Date().toISOString();

            // Log the note change
            const logEntry = {
                type: 'update_notes',
                itemId: item.itemId,
                SKU: item.SKU,
                location: item.location,
                user: getUserIdentifier(),
                timestamp: timestamp,
                details: {
                    oldValue: oldNotes,
                    newValue: notes
                }
            };
            if (item.currentRecountBatchId) {
                logEntry.type = 'recount_update_notes';
                logEntry.details.recountBatchId = item.currentRecountBatchId;
            }

            try {
                await logTransaction(logEntry); // Use unified logging
                console.log(`Updated notes for ${itemId} (SKU: ${item.SKU}, Loc: ${item.location})`);
            } catch (logError) {
                 console.error(`Failed to log note update for ${itemId}:`, logError);
            }

            // Trigger autosave
            autoSave().catch(e => console.error("Autosave failed after updating notes:", e)); // ***** ENSURE save is triggered *****
            // No re-render needed just for notes if using event delegation correctly
             console.log(`Notes updated for ${itemId}, background save triggered.`);
        }
    } catch (error) {
        console.error(`Error updating notes for itemId ${itemId}:`, error);
        // Maybe provide visual feedback of save failure?
        // Manually reset textarea on error
        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`);
        const textarea = itemDiv?.querySelector('textarea[data-type="notes-input"]');
        if(textarea) {
             findInventoryItemByItemId(itemId).then(item => { // Fetch original value on error
                 if(item) textarea.value = item.notes ?? '';
             });
        }
    }
}


// ** NEW: Function to handle adding recount adjustments **
// (Keep this function as is from previous versions, assuming it's correct)
async function addRecountAdjustment(itemId, adjustmentTxId, adjustmentQtyStr) {
    if (!itemId || !adjustmentTxId || !adjustmentQtyStr) {
         alert("Missing information for adjustment (Item ID, Transaction ID, or Quantity).");
         return;
    }
    const adjustmentQty = Number(adjustmentQtyStr);
    if (isNaN(adjustmentQty)) {
         alert("Invalid quantity entered for adjustment. Please enter a number.");
         return;
    }
    if (adjustmentQty === 0) {
        alert("Adjustment quantity cannot be zero.");
        return;
    }

    // Find the item FIRST to check if it's part of an active recount
     const item = await findInventoryItemByItemId(itemId);
     if (!item) {
          alert(`Item with ID ${itemId} not found.`);
          return;
     }
     if (!item.currentRecountBatchId) {
          alert(`Item ${item.SKU} at ${item.location} is not currently part of an active recount batch.`);
          return;
     }
     const activeRecountBatchId = item.currentRecountBatchId; // Use the ID from the item


    try {
        const timestamp = new Date().toISOString();
        const user = getUserIdentifier();

        // 1. Log the adjustment event itself using the DB function
        const adjustmentData = {
            // adjustmentId will be auto-generated by DB
            itemId: itemId,
            recordedDuringRecountBatchId: activeRecountBatchId,
            adjustmentTransactionId: adjustmentTxId.trim(),
            adjustmentQuantity: adjustmentQty,
            timestamp: timestamp,
            user: user
        };
        await DB.addRecountAdjustment(adjustmentData); // Log to its specific store
        console.log(`Recount adjustment logged for itemId ${itemId}: TxID=${adjustmentTxId}, Qty=${adjustmentQty}, Batch=${activeRecountBatchId}`);


        // 2. Update the item's counted quantity using the main count update function
        const currentCount = item.counted === null ? 0 : item.counted; // Treat null count as 0 for calc
        const newNetQuantity = currentCount + adjustmentQty;

        // Use recordOrUpdateCount, which handles state update, logging, and saving
        const updatedItem = await recordOrUpdateCount(
            itemId,
            newNetQuantity,
            'recount_adjustment', // Source type
            {
                 adjustmentTxId: adjustmentData.adjustmentTransactionId, // Include original Tx ID in details
                 adjustmentQty: adjustmentData.adjustmentQuantity,
                 previousPhysicalCount: currentCount, // Log count *before* this adjustment
                 // recountBatchId is added automatically by recordOrUpdateCount if item.currentRecountBatchId is set
            }
        );

        if (updatedItem) {
             // Adjustment added and count updated successfully
             alert(`Adjustment added for ${item.SKU} at ${item.location}.\nNew Count: ${updatedItem.counted}`);
             // Re-render the UI to show updated count and the new adjustment in the list
             applyCurrentFilters(); // Re-render list
             updateSummaryCards();
        } else {
             // recordOrUpdateCount might have failed (e.g., item became inactive?)
             // The adjustment *is* logged, but the count wasn't updated.
             console.error(`Adjustment logged for ${itemId}, but failed to update item count.`);
             alert(`Error: Adjustment was logged, but failed to update the item's count. Please check item status or console.`);
             // Re-render might be needed to clear input fields
             applyCurrentFilters();
        }

    } catch (error) {
        console.error(`Error adding recount adjustment for itemId ${itemId}:`, error);
        alert(`Failed to add recount adjustment. See console for details. ${error.message}`);
    }
}

function renderInventoryList() {
    const container = document.getElementById('inventoryList');
    if (!container) { console.error("Inventory list container not found."); return; }

    try { // Outer try block for the whole function
        container.innerHTML = ''; // Clear previous list
        const fragment = document.createDocumentFragment();

        if (currentInventory.length === 0) {
            // ... (Keep the improved 'no items' message logic) ...
            let message = 'No items match the current criteria.';
            const hasActiveFilters = currentFilters.location || currentFilters.searchTerm || currentFilters.status !== 'active' || currentFilters.filterByToCountStatus !== 'to_count';

            if (database.inventory.length === 0) {
                message = 'Inventory is empty. Import a CSV to begin.';
            } else if (!hasActiveFilters && !database.inventory.some(item => item.isActive && item.toCount)) {
                 message = 'No items currently marked "To Count". Start a new count cycle or use the Summary Card filters to view other items (e.g., "Counted", "Active", "Total").';
            } else {
                message = 'No items match: ';
                let filterParts = [];
                if (currentFilters.location) filterParts.push(`Location="${currentFilters.location}"`);
                if (currentFilters.searchTerm) filterParts.push(`Search="${currentFilters.searchTerm}"`);
                if (currentFilters.status !== 'all') filterParts.push(`Status="${currentFilters.status}"`);

                switch (currentFilters.filterByToCountStatus) {
                    case 'counted': filterParts.push("View='Finished Items'"); break;
                    case 'to_count': filterParts.push("View='Items To Count'"); break;
                    case 'all': filterParts.push("View='All Items'"); break;
                    default: break; // Should not happen, but good practice
                }
                message += filterParts.join(', ');
                 if (currentFilters.filterByToCountStatus === 'to_count') {
                     message += ". Try the 'Counted' card to see finished items, or 'Active'/'Total' for broader views.";
                 } else if (currentFilters.filterByToCountStatus === 'counted') {
                      message += ". Try the 'Uncounted' card to see items still needing count, or 'Active'/'Total'.";
                 } else if (currentFilters.filterByToCountStatus === 'all' && currentFilters.status === 'active') {
                     message += ". Try the 'Total Items' card to include inactive items.";
                 }
            }
            container.innerHTML = `<p>${message}</p>`;
            return; // Exit function if no items to render
        }

        currentInventory.forEach(item => {
            // Inner try...catch for rendering a single item
            try {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'inventory-item';
                itemDiv.dataset.sku = item.SKU;
                itemDiv.dataset.itemId = item.itemId;

                // --- Status classes ---
                 if (!item.isActive) {
                     itemDiv.classList.add('is-inactive');
                 } else if (item.toCount) {
                     itemDiv.classList.add('is-tocount');
                     if (item.isUncounted) {
                         itemDiv.classList.add('is-uncounted');
                     }
                 } else {
                     itemDiv.classList.add('is-finished');
                     if (!item.isUncounted && item.counted !== null) {
                         itemDiv.classList.add('is-counted');
                     }
                 }
                if (item.isReel) itemDiv.classList.add('is-reel');
                if (item.isTwoWayReel) itemDiv.classList.add('is-two-way-reel');

                // --- Create Columns ---
                const columns = {};
                columns.details = document.createElement('div');
                columns.count = document.createElement('div');
                columns.sequences1 = document.createElement('div');
                columns.sequences2 = document.createElement('div');
                columns.notes = document.createElement('div');
                columns.actions = document.createElement('div');
                columns.details.className = 'item-details';
                columns.count.className = 'item-count';
                columns.sequences1.className = 'item-sequences seq-pair-1';
                columns.sequences2.className = 'item-sequences seq-pair-2';
                columns.notes.className = 'item-notes';
                columns.actions.className = 'item-actions';

                // --- Populate Details Column ---
                const reelInfo = item.isReel ? ` (Reel${item.reelNumber ? `: ${item.reelNumber}` : ''}${item.isTwoWayReel ? ', 2-Way' : ''})` : '';
                const toCountIndicator = item.toCount ? `<span class="tocount-indicator" title="Marked for current count cycle">🎯</span>` : '';
                const finishedIndicator = !item.toCount && item.isActive ? `<span class="finished-indicator" title="Finished for cycle (Count: ${item.counted ?? 'Uncounted'})">✔️</span>` : '';
                const inactiveIndicator = !item.isActive ? '<span class="inactive-indicator" title="Inactive Item">🚫</span>' : '';

                columns.details.innerHTML = `
                    <div class="item-sku">
                         ${inactiveIndicator} ${item.isActive ? (item.toCount ? toCountIndicator : finishedIndicator) : ''}
                        ${item.SKU}${reelInfo}
                    </div>
                    <div class="item-desc">${item.Description || 'N/A'}</div>
                    <div class="item-loc">Loc: ${item.location || 'N/A'}</div>
                    <div class="item-id" style="font-size: 0.7em; color: grey;">ID: ${item.itemId}</div>
                `;

                // --- Populate Count Column ---
                 const countInput = document.createElement('input');
                 countInput.type = 'number';
                 // ***** MODIFIED ***** Always start blank if item is 'toCount'
                 countInput.value = item.toCount ? '' : (item.counted === null || item.counted === undefined) ? '' : item.counted;
                 countInput.dataset.type = 'count-input';
                 countInput.min = "0";
                 // Disable if inactive, or if it's a reel with a valid calculation override
                 const disableCountInput = !item.isActive || (item.isReel && item.footageFactor > 0 && item.calculatedFootage !== null);
                 countInput.disabled = disableCountInput;
                 const isFinished = !item.toCount && item.isActive;
                 countInput.readOnly = isFinished; // Readonly if finished for the cycle

                 // Tooltip logic
                 if (!item.isActive) {
                    countInput.title = "Item is inactive";
                 } else if (item.isReel && item.footageFactor > 0 && item.calculatedFootage !== null) {
                    countInput.title = "Quantity calculated from footage";
                 } else if (isFinished) {
                     countInput.title = "Item finished for this cycle (view only)";
                 } else if (item.toCount) {
                     countInput.title = "Enter current count"; // Default title for active/toCount items
                 }

                 // ***** MODIFIED ***** Make captured quantity clickable
                 let capturedQtyHtml = '';
                 if (item.capturedQuantity !== null && item.capturedQuantity !== undefined) {
                     capturedQtyHtml = `<span class="captured-qty-display clickable-value"
                                             data-action="apply-expected-qty"
                                             data-value="${item.capturedQuantity}"
                                             title="Click to apply ${item.capturedQuantity} to the input">(Expected: ${item.capturedQuantity})</span>`;
                 } else {
                     capturedQtyHtml = `<span class="captured-qty-display">(Expected: N/A)</span>`; // Or hide if null? Let's show N/A
                 }

                columns.count.innerHTML = `<span>Qty:${capturedQtyHtml}</span>`;
                columns.count.appendChild(countInput);


                // --- Populate Sequences Columns ---
                if (item.isReel) {
                    // ***** MODIFIED ***** Helper function for clickable sequence display
                    const createSequenceDisplaySpan = (type, value) => {
                        const displayValue = (value !== null && value !== undefined && String(value).trim() !== '') ? String(value).trim() : '---';
                        const actualType = type; // 'Inner', 'Outer', 'Inner2', 'Outer2'
                        const sequenceInputName = actualType.toLowerCase(); // 'inner', 'outer', 'inner2', 'outer2'

                        if (displayValue === '---') {
                            // Not clickable if no value captured
                            return `<span class="captured-sequence-display is-empty">${actualType}: ${displayValue}</span>`;
                        } else {
                            // Create clickable span with data attributes, add clickable-value class
                            return `<span class="captured-sequence-display clickable-value"
                                          data-action="apply-sequence"
                                          data-sequence-type="${sequenceInputName}"
                                          data-sequence-value="${displayValue}"
                                          title="Click to apply '${displayValue}' to the input below">${actualType}: ${displayValue}</span>`;
                        }
                    };
                    // ***** END OF MODIFIED HELPER FUNCTION *****

                    const disableSequenceInput = !item.isActive || !item.toCount; // Disable if inactive or finished

                    // Function to create input, ensure blank if item.toCount
                    const createSequenceInput = (sequenceType, currentValue) => {
                        const input = document.createElement('input');
                        input.type = 'number';
                        input.dataset.sequence = sequenceType;
                        // ***** MODIFIED ***** Render blank if item needs counting
                        input.value = item.toCount ? '' : currentValue ?? '';
                        input.placeholder = sequenceType.charAt(0).toUpperCase() + sequenceType.slice(1); // e.g., Inner
                        input.min = "0";
                        input.disabled = disableSequenceInput;
                        input.readOnly = disableSequenceInput; // Match disabled state for clarity
                         if (disableSequenceInput) {
                            input.title = !item.isActive ? "Item is inactive" : "Item finished for cycle";
                         }
                        return input;
                    };

                    // Pair 1 - Use helper for display spans, create inputs ensuring blank if toCount
                    const seq1Group = document.createElement('div');
                    seq1Group.className = 'sequence-pair-container'; // Container for both groups + total/factor

                    const group1Inner = document.createElement('div');
                    group1Inner.className = 'sequence-group';
                    group1Inner.innerHTML = createSequenceDisplaySpan('Inner', item.innerSequence);
                    group1Inner.appendChild(createSequenceInput('inner', item.innerSequence));

                    const group1Outer = document.createElement('div');
                    group1Outer.className = 'sequence-group';
                    group1Outer.innerHTML = createSequenceDisplaySpan('Outer', item.outerSequence);
                    group1Outer.appendChild(createSequenceInput('outer', item.outerSequence));

                    columns.sequences1.appendChild(group1Inner);
                    columns.sequences1.appendChild(group1Outer);
                    columns.sequences1.appendChild(document.createTextNode(' = ')); // Add equals sign


                    // Pair 2 (Only if two-way) - Use helper for display spans
                    if (item.isTwoWayReel) {
                        const group2Inner = document.createElement('div');
                        group2Inner.className = 'sequence-group';
                        group2Inner.innerHTML = createSequenceDisplaySpan('Inner2', item.innerSequence2);
                        group2Inner.appendChild(createSequenceInput('inner2', item.innerSequence2));

                        const group2Outer = document.createElement('div');
                        group2Outer.className = 'sequence-group';
                        group2Outer.innerHTML = createSequenceDisplaySpan('Outer2', item.outerSequence2);
                        group2Outer.appendChild(createSequenceInput('outer2', item.outerSequence2));

                        columns.sequences2.appendChild(group2Inner);
                        columns.sequences2.appendChild(group2Outer);
                        columns.sequences2.appendChild(document.createTextNode(' = '));
                        columns.sequences2.style.visibility = 'visible';
                    } else {
                        columns.sequences2.innerHTML = '';
                        columns.sequences2.style.visibility = 'hidden';
                    }

                    // Append Total Calculated Footage and Factor (logic unchanged, append to seq1 column)
                    const totalFootageDisplay = document.createElement('span');
                    totalFootageDisplay.className = 'calculated-footage-display total-footage';
                    const hasAnySequenceInput = item.innerSequence || item.outerSequence || item.innerSequence2 || item.outerSequence2;
                    if (item.calculatedFootage !== null) {
                        totalFootageDisplay.textContent = `Total: ${item.calculatedFootage.toFixed(2)} ft`;
                        totalFootageDisplay.style.color = '';
                        totalFootageDisplay.title = '';
                    } else if (hasAnySequenceInput) {
                         // Show invalid only if sequences *were* entered but calculation failed
                         totalFootageDisplay.textContent = 'Total: Invalid';
                         totalFootageDisplay.style.color = 'var(--danger-color)';
                         totalFootageDisplay.title = 'Incomplete or invalid sequence values entered.';
                    } else {
                         totalFootageDisplay.textContent = 'Total: ---';
                         totalFootageDisplay.style.color = '';
                         totalFootageDisplay.title = '';
                    }
                    columns.sequences1.appendChild(totalFootageDisplay);

                } else {
                    // Hide sequence columns if not a reel
                    columns.sequences1.innerHTML = '';
                    columns.sequences1.style.visibility = 'hidden';
                    columns.sequences2.innerHTML = '';
                    columns.sequences2.style.visibility = 'hidden';
                }

                // --- Populate Notes Column ---
                const notesTextarea = document.createElement('textarea');
                notesTextarea.dataset.type = 'notes-input';
                // ***** MODIFIED ***** Render blank if item needs counting
                notesTextarea.value = item.toCount ? '' : item.notes ?? '';
                notesTextarea.placeholder = 'Add notes...';
                notesTextarea.disabled = !item.isActive; // Allow notes even if finished, but not if inactive
                notesTextarea.readOnly = !item.isActive; // Match disabled state
                columns.notes.appendChild(notesTextarea);

                // --- Populate Actions Column ---
                const flagButtonDisabled = !item.isActive || !item.toCount; // Can only flag active items needing count
                const finalizeButtonDisabled = !item.isActive || !item.toCount; // Can only finalize active items needing count
                columns.actions.innerHTML = `
                    <button data-action="flag" class="btn-warning" title="Flag item as uncounted (resets count to null)" ${flagButtonDisabled ? 'disabled' : ''}>Flag</button>
                    <button data-action="view-history" class="btn-secondary" title="View history for this item">History</button>
                    <button data-action="finalize-item" class="btn-success" title="Record count and finish this item for the cycle" ${finalizeButtonDisabled ? 'disabled' : ''}>Record & Finish</button>
                `;

                // --- Append columns ---
                itemDiv.appendChild(columns.details);
                itemDiv.appendChild(columns.count);
                itemDiv.appendChild(columns.sequences1);
                itemDiv.appendChild(columns.sequences2);
                itemDiv.appendChild(columns.notes);
                itemDiv.appendChild(columns.actions);

                // Append the completed itemDiv to the fragment
                fragment.appendChild(itemDiv);

            } catch (itemError) { // Catch errors rendering a single item
                 console.error(`Error rendering item ${item?.SKU || item?.itemId || '(Unknown Item)'}:`, itemError);
                const errorDiv = document.createElement('div');
                errorDiv.className = 'inventory-item error-item';
                errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering item ${item?.SKU || '(Unknown SKU)'}</p>`;
                fragment.appendChild(errorDiv); // Append error placeholder to fragment
            }
        }); // End currentInventory.forEach

        container.appendChild(fragment);
        console.log(`Rendered ${currentInventory.length} items matching filters:`, currentFilters);

    } catch (error) { // Catch errors in the overall rendering process
        console.error("Error rendering inventory list:", error);
        container.innerHTML = `<p class="error-message">Error displaying inventory list. Check console.</p>`;
   }
}
// --- End of renderInventoryList ---

// Use checks for elements before setting textContent
function updateSummaryCards() {
    try {
        // Calculate counts based on the full dataset
        const totalItems = database.inventory.length;
        const activeItems = database.inventory.filter(item => item.isActive);
        const activeCount = activeItems.length;
        // "Counted" means active, not flagged uncounted, AND not marked 'toCount' (i.e., finished)
        const countedFinishedActive = activeItems.filter(item => !item.toCount && !item.isUncounted).length;
         // "Uncounted" means active AND marked 'toCount' (i.e., still needs counting)
        const uncountedToDoActive = activeItems.filter(item => item.toCount).length;


        // Helper to update card text safely
        const updateCardText = (cardId, value) => {
             const cardElement = document.getElementById(cardId);
             if (cardElement) {
                 const pElement = cardElement.querySelector('p');
                 if (pElement) {
                     pElement.textContent = value;
                 } else {
                     console.warn(`Could not find 'p' element within card '${cardId}'`);
                 }
             } else {
                 console.warn(`Could not find card element with id '${cardId}'`);
             }
        };

        updateCardText('total-items', totalItems);
        updateCardText('active-items', activeCount);
        updateCardText('counted-items', countedFinishedActive); // Represents finished items
        updateCardText('uncounted-items', uncountedToDoActive); // Represents items to count

    } catch (error) {
        console.error("Error updating summary cards:", error);
    }
}

function renderHistoryView() {
    const container = document.getElementById('historyListContainer');
    if (!container) return;

    try {
        container.innerHTML = '';
        if (!database.transactionHistory || database.transactionHistory.length === 0) {
            container.innerHTML = '<p>No transaction history recorded yet.</p>';
            return;
        }
        const fragment = document.createDocumentFragment();
        // Use the already sorted (descending) history
        database.transactionHistory.forEach(entry => {
             try {
                const div = document.createElement('div');
                div.className = 'history-entry';
                const date = new Date(entry.timestamp);
                const formattedDate = date.toLocaleString();

                let detailsHtml = '';
                // Enhance details based on type - SINGLE SWITCH BLOCK
                switch(entry.type) {
                    case 'update_count':
                        const fromVal = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                        detailsHtml = `Updated count for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) from ${fromVal} to <strong>${entry.details.newValue}</strong> via ${entry.details.source || 'manual'}.`;
                         if (entry.details.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                        break;
                    case 'flag_uncounted':
                         detailsHtml = `Flagged <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) as uncounted. (Previous: ${entry.details.previousState?.counted ?? 'N/A'})`;
                        break;
                    case 'update_notes':
                         detailsHtml = `Updated notes for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}).`; // Keep concise for global view
                        break;
                    case 'description_change':
                         detailsHtml = `Description change for <strong>${entry.SKU}</strong> from "${entry.details.oldDescription}" to "${entry.details.newDescription}" during import.`;
                         break;
                    case 'status_change': // UPDATED Logic
                         detailsHtml = `Status change for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) to <strong>${entry.details.newStatus ? 'Active' : 'Inactive'}</strong>. Reason: ${entry.details.reason || 'Unknown'}`;
                         break;
                    case 'import_csv': // Regular CSV Import (Context: update)
                         detailsHtml = `CSV Import [Update] (${entry.details.fileName || 'N/A'}): Added ${entry.details.addedCount}, Updated ${entry.details.updatedCount}, Skipped ${entry.details.skippedCount}.`;
                         if (entry.details.descChanges > 0) detailsHtml += ` (${entry.details.descChanges} desc changes).`;
                         break;
                    case 'new_count_started_import': // NEW TYPE
                         detailsHtml = `Started New Count Cycle via CSV Import (${entry.details.fileName || 'N/A'}). Marked ${entry.details.itemsMarkedToCount} items 'To Count'. Processed ${entry.details.skusImported} records (Added: ${entry.details.addedCount}, Updated: ${entry.details.updatedCount}, Skipped: ${entry.details.skippedCount}, Marked Not-to-Count: ${entry.details.markedNotToCount})`;
                         break;
                     case 'recount_items_imported': // NEW TYPE for recount import
                         detailsHtml = `Imported items for Recount Batch '${entry.details.recountBatchId || 'N/A'}' via CSV (${entry.details.fileName || 'N/A'}). Added ${entry.details.itemsAddedToRecount} items to batch, reset counts. (Added New: ${entry.details.addedCount}, Updated Existing: ${entry.details.updatedCount}, Skipped: ${entry.details.skippedCount})`;
                         break;
                    case 'inventory_finalized': // MODIFIED details
                         detailsHtml = `<strong>Inventory Finalized.</strong> ${entry.details.deactivatedReelCount} REELS marked inactive. ${entry.details.toCountClearedCount} items had 'To Count' flag cleared.`;
                         break;
                     case 'item_count_finalized':
                          detailsHtml = `Finished count for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}). Final Count: ${entry.details?.finalCount ?? 'Uncounted'}.`;
                          break;
                     case 'recount_adjustment_update': // Log generated by recordOrUpdateCount for recount
                     case 'recount_physical_update':   // Log generated by recordOrUpdateCount for recount
                          const fromAdjVal = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                          const adjSource = entry.details.source === 'recount_adjustment' ? `adjustment (Tx: ${entry.details.adjustmentTxId})` : 'physical count';
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Update for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) from ${fromAdjVal} to <strong>${entry.details.newValue}</strong> via ${adjSource}.`;
                          break;
                     case 'recount_flag_uncounted': // Log generated by flagUncounted for recount
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Flagged <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}) as uncounted. (Previous: ${entry.details.previousState?.counted ?? 'N/A'})`;
                          break;
                     case 'recount_update_notes': // Log generated by updateItemNotes for recount
                          detailsHtml = `Recount [${entry.details.recountBatchId}] Updated notes for <strong>${entry.SKU}</strong> (${entry.location || 'N/A'}).`;
                          break;
                    default:
                        detailsHtml = `Action: ${entry.type} for ${entry.SKU || 'N/A'} (${entry.location || 'N/A'})`;
                } // End of the single switch statement

                // Set the innerHTML using the generated detailsHtml
                // Include ItemID for easier debugging/lookup
                const itemIdHtml = entry.itemId ? `<span style="color: grey; font-size: 0.9em;"> (ItemID: ${entry.itemId})</span>` : '';
                div.innerHTML = `
                    <div class="history-meta">${formattedDate} - ${entry.user || 'System'} - ID: ${entry.id || 'N/A'}</div>
                    <div class="history-details">${detailsHtml}${itemIdHtml}</div>
                `;
                fragment.appendChild(div);

             } catch(entryError) { // Catch errors rendering a single entry
                 console.error("Error rendering history entry:", entry, entryError);
                  const errorDiv = document.createElement('div');
                  errorDiv.className = 'history-entry error-entry';
                  errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering history entry (ID: ${entry?.id || 'N/A'})</p>`;
                  fragment.appendChild(errorDiv);
             }
        }); // End forEach loop

        container.appendChild(fragment); // Append all entries at once

    } catch (error) { // Catch errors related to the overall process
        console.error("Error rendering history view:", error);
        container.innerHTML = `<p class="error-message">Error displaying history. Check console.</p>`;
    }
}

function toggleHistoryView(show) {
    try {
        const view = document.getElementById('history-view');
        const mainInventory = document.getElementById('inventory');

        if (!view || !mainInventory) return;

        if (show) {
            renderHistoryView();
            view.style.display = 'block';
            mainInventory.style.display = 'none';
        } else {
            view.style.display = 'none';
            mainInventory.style.display = 'block';
        }
    } catch (error) {
        console.error("Error toggling history view:", error);
    }
}

// --- Item Specific History Modal ---
// Accept itemId, sku, and description
async function showItemHistory(itemId, sku, description) {
    console.log(`[showItemHistory] Function called with ItemID: ${itemId}, SKU: ${sku}, Desc: ${description}`);
    const modal = document.getElementById('itemHistoryModal');
    const title = document.getElementById('itemHistoryModalTitle');
    const body = document.getElementById('itemHistoryModalBody');

    if (!modal || !title || !body) {
        console.error("[showItemHistory] Item history modal elements not found! Cannot display modal.");
        alert("Error: Could not find the history modal elements.");
        return;
    }
    console.log("[showItemHistory] Modal elements found:", { modal, title, body });

    // Use provided SKU and Description for title consistency
    const displaySku = sku || 'Unknown SKU';
    const displayDesc = description || 'No Description';
    title.textContent = `History for Item: ${displaySku}`;
    title.title = `ItemID: ${itemId}\nDescription: ${displayDesc}`; // Add more info to tooltip

    console.log(`[showItemHistory] Set modal title to: ${title.textContent}`);

    body.innerHTML = '<p>Loading history...</p>';
    modal.style.display = 'block'; // Show modal

    try {
        // Query by ItemID using the appropriate DB function
        console.log(`[showItemHistory] Querying history from DB for ItemID: '${itemId}'`);
        const itemHistory = await DB.getTransactionHistoryByItemId(itemId);
        console.log(`[showItemHistory] History records received from DB for ItemID ${itemId}:`, itemHistory);

        body.innerHTML = ''; // Clear loading

        if (!Array.isArray(itemHistory) || itemHistory.length === 0) {
             body.innerHTML = `<p>No specific transaction history found for this item (ID: ${itemId}).</p>`;
             console.log(`[showItemHistory] Displaying 'No history' message for ItemID ${itemId}.`);
        } else {
            const fragment = document.createDocumentFragment();
            // History from DB function should already be sorted descending
            itemHistory.forEach(entry => {
                try {
                    const div = document.createElement('div');
                    div.className = 'history-entry';
                    const date = new Date(entry.timestamp);
                    const formattedDate = date.toLocaleString();
                    let detailsHtml = '';

                    // Simplified details for item-specific view
                    switch(entry.type) {
                         case 'update_count':
                            const fromValItem = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                            detailsHtml = `Count set to <strong>${entry.details?.newValue ?? 'N/A'}</strong> (was ${fromValItem}) via ${entry.details?.source || 'manual'}.`;
                            if (entry.details?.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                            break;
                        case 'flag_uncounted':
                            detailsHtml = `Flagged as uncounted (Previous count: ${entry.details.previousState?.counted ?? 'N/A'}).`;
                            break;
                        case 'update_notes':
                             detailsHtml = `Notes updated to: "${entry.details?.newValue ?? ''}" (was "${entry.details?.oldValue ?? ''}")`;
                             break;
                         case 'description_change':
                             detailsHtml = `Description changed to "${entry.details?.newDescription ?? ''}" (was "${entry.details?.oldDescription ?? ''}").`;
                             break;
                        case 'status_change':
                             detailsHtml = `Status changed to <strong>${entry.details?.newStatus ? 'Active' : 'Inactive'}</strong>. Reason: ${entry.details?.reason || 'Unknown'}`;
                             break;
                         case 'import_csv':
                             detailsHtml = `Item data updated during CSV Import [Update] (${entry.details?.fileName || 'N/A'}).`;
                             break;
                         case 'new_count_started_import':
                            detailsHtml = `Marked 'To Count' & reset via New Count Cycle Import (${entry.details?.fileName || 'N/A'}).`;
                            break;
                         case 'recount_items_imported':
                            detailsHtml = `Added to Recount Batch '${entry.details?.recountBatchId || 'N/A'}' & reset via Recount Import (${entry.details?.fileName || 'N/A'}).`;
                            break;
                        case 'inventory_finalized': // Less relevant for single item, but might appear if it was a reel deactivated
                            detailsHtml = `Inventory Finalized (This item might have been affected if reel status changed).`;
                            break;
                         case 'item_count_finalized':
                             detailsHtml = `Marked as finished for cycle. Final Count: ${entry.details?.finalCount ?? 'Uncounted'}.`;
                             break;
                         case 'recount_adjustment_update':
                         case 'recount_physical_update':
                            const fromAdjValItem = entry.details.wasUncounted ? 'uncounted' : (entry.details.oldValue ?? 'N/A');
                             const adjSourceItem = entry.details.source === 'recount_adjustment' ? `adjustment (Tx: ${entry.details.adjustmentTxId})` : 'physical count';
                             detailsHtml = `Recount [${entry.details.recountBatchId}] update from ${fromAdjValItem} to <strong>${entry.details.newValue}</strong> via ${adjSourceItem}.`;
                             break;
                          case 'recount_flag_uncounted':
                               detailsHtml = `Recount [${entry.details.recountBatchId}] flagged as uncounted (Previous: ${entry.details.previousState?.counted ?? 'N/A'}).`;
                               break;
                           case 'recount_update_notes':
                               detailsHtml = `Recount [${entry.details.recountBatchId}] notes updated.`;
                               break;
                        default:
                            detailsHtml = `Action: ${entry.type}`;
                            if (entry.details && Object.keys(entry.details).length > 0) {
                                detailsHtml += ` - Details: ${JSON.stringify(entry.details)}`;
                            }
                    }

                    // Display meta info (user, timestamp, transaction ID)
                    div.innerHTML = `
                        <div class="history-meta">${formattedDate} - ${entry.user || 'System'} (ID: ${entry.id || 'N/A'})</div>
                        <div class="history-details">${detailsHtml}</div>
                    `;
                    fragment.appendChild(div);
                } catch (renderEntryError) {
                     console.error(`[showItemHistory] Error rendering single history entry:`, entry, renderEntryError);
                     // Optionally add an error placeholder for this entry in the modal
                }
            });
            body.appendChild(fragment);
            console.log(`[showItemHistory] Rendered ${itemHistory.length} history entries for ItemID ${itemId}.`);
        }

    } catch (error) {
        console.error(`[showItemHistory] Error loading or rendering history for ItemID ${itemId}:`, error);
        body.innerHTML = `<p class="error-message">Error loading history for this item. Check console.</p>`;
    }
}


function closeItemHistoryModal() {
    const modal = document.getElementById('itemHistoryModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// --- CSV Handling ---
// MODIFIED to handle itemId structure, import contexts, and use findExistingItemRecord
async function showImportDialog(importContext = 'update') { // context: 'update', 'new_count', 'recount'
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, text/csv';
    input.style.display = 'none';

    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        console.log(`Attempting to import CSV: ${file.name} (Context: ${importContext})`);

        // --- Recount Batch Setup (if needed) ---
        let recountBatchId = null;
        let cutOffDate = null;
        if (importContext === 'recount') {
            // Prompt for recount batch ID and cut-off date
             const batchIdentifier = prompt(`Enter a unique identifier for this RECOUNT batch (e.g., YYMMDD.R<n>, like ${new Date().toISOString().slice(2,10).replace(/-/g,'')}.R1):`);
             const dateInput = prompt(`Enter the Cut-off Date for this recount batch (YYYY-MM-DD):`);

             if (!batchIdentifier || !dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
                 alert("Recount import cancelled: Valid Batch Identifier and Cut-off Date (YYYY-MM-DD) are required.");
                 if (input.parentNode) { input.parentNode.removeChild(input); }
                 return;
             }
             recountBatchId = batchIdentifier.trim();
             cutOffDate = dateInput;

             // Check if batch ID already exists and create if not
              try {
                 const existingBatch = await DB.getRecountBatchDetails(recountBatchId);
                 if (existingBatch) {
                     alert(`Recount Batch ID "${recountBatchId}" already exists. Please use a unique ID.`);
                     if (input.parentNode) { input.parentNode.removeChild(input); }
                     return;
                 }
                 // Create the batch record in the DB
                 await DB.createRecountBatch({
                     recountBatchId: recountBatchId,
                     cutOffDate: cutOffDate,
                     status: 'open',
                     createdAt: new Date().toISOString(),
                     createdBy: getUserIdentifier()
                 });
                 console.log(`Created recount batch ${recountBatchId} with cut-off ${cutOffDate}.`);
              } catch (dbError) {
                  console.error("Error checking/creating recount batch:", dbError);
                  alert(`Failed to create recount batch in database. ${dbError.message}`);
                  if (input.parentNode) { input.parentNode.removeChild(input); }
                  return;
              }
        }

        try {
            const fileContent = await readFile(file).catch(readError => {
                throw new Error(`Failed to read file: ${readError.message}`);
            });

            // ** Using Papa Parse **
            const result = Papa.parse(fileContent, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false, // Keep all as strings initially
                transformHeader: header => {
                    // Remove BOM character if present at the start, then trim
                    let cleanHeader = header;
                    if (cleanHeader && cleanHeader.charCodeAt(0) === 0xFEFF) {
                        cleanHeader = cleanHeader.substring(1);
                    }
                    return cleanHeader ? cleanHeader.trim() : header; // Trim non-empty headers
                }
            });

            console.log("PapaParse Meta:", result.meta);
            console.log("PapaParse Headers (result.meta.fields):", result.meta.fields);

            if (result.errors.length > 0) {
                console.error("CSV Parsing Errors:", result.errors);
                // Provide more detail on the first error
                const firstError = result.errors[0];
                throw new Error(`CSV parsing error on row ${firstError.row + 1}: ${firstError.message}. Check file format.`);
            }
            const parsedData = result.data;
            if (!parsedData || parsedData.length === 0) {
                throw new Error("CSV file is empty or contains no data rows.");
            }

            // --- Data Processing ---
            try {
                 // Use a map to store the latest state of each item (keyed by itemId) during processing
                let processedItemsMap = new Map();
                // Pre-populate map with existing items from DB for efficient lookup/update
                database.inventory.forEach(item => processedItemsMap.set(item.itemId, { ...item }));

                const identifiersInThisImport = new Set(); // Track unique identifiers (reel# or sku|loc) from the file
                let skippedCount = 0;
                let descChanges = 0;
                let itemsMarkedToCount = 0; // Specific to new_count context
                let itemsAddedToRecount = 0; // Specific to recount context
                let importAddedCount = 0; // Items completely new to the DB
                let importUpdatedCount = 0; // Items existing in DB that were updated by import


                // --- Header Detection ---
                const headers = result.meta.fields;
                const findHeader = (possibleNames) => {
                    for (const name of possibleNames) {
                        const lowerName = name.toLowerCase();
                        const found = headers.find(h => h && typeof h === 'string' && h.trim().toLowerCase() === lowerName);
                        if (found) return found; // Return the original header name from the file
                    }
                    return null;
                };

                // Find mandatory headers first
                const skuHeader = findHeader(['sku', 'item', 'partnumber', 'part number']);
                const locHeader = findHeader(['location', 'loc']);
                const reelNumHeader = findHeader(['reelnumber', 'reel num', 'reel #', 'reel no', 'reel no.', 'reel number']);

                if (!skuHeader) throw new Error("Required header 'SKU' (or similar) not found in CSV.");
                if (!locHeader && !reelNumHeader) throw new Error("Required header 'location' OR 'reelNumber' not found in CSV.");

                // Find optional headers
                 const descHeader = findHeader(['description', 'desc']);
                 const countHeader = findHeader(['counted', 'quantity', 'qty', 'count']);
                 const capturedQtyHeader = findHeader(['capturedquantity', 'expectedquantity', 'expected qty', 'captured qty']);
                 const notesHeader = findHeader(['notes', 'note', 'comments']);
                 const isActiveHeader = findHeader(['isactive', 'active']);
                 const isReelHeader = findHeader(['isreel', 'reel']);
                 const isTwoWayReelHeader = findHeader(['istwowayreel', 'twowayreel', 'two way reel', 'two-way', '2-way', '2 way']);
                 const footageFactorHeader = findHeader(['footagefactor', 'factor', 'ft factor', 'feet', 'footage', 'ft', 'reelft', 'reel ft', 'reel footage']);
                 const innerSeqHeader = findHeader(['innersequence', 'inner seq', 'inner', 'in1', 'inner1', 'i1']);
                 const outerSeqHeader = findHeader(['outersequence', 'outer seq', 'outer', 'ou1', 'outer1', 'o1']);
                 const innerSeq2Header = findHeader(['innersequence2', 'inner seq 2', 'inner2', 'in2', 'i2']);
                 const outerSeq2Header = findHeader(['outersequence2', 'outer seq 2', 'outer2', 'ou2', 'o2']);

                console.log("Detected Headers:", { skuHeader, descHeader, locHeader, reelNumHeader, countHeader, /* etc */ });


                // --- Process Rows ---
                parsedData.forEach((row, index) => {
                    const rowNum = index + 2; // For user-friendly error messages
                    const sku = String(row[skuHeader] || '').trim();
                    const location = String(row[locHeader] || '').trim();
                    const reelNumber = String(row[reelNumHeader] || '').trim();

                    // --- Basic Validation and Duplicate Check ---
                    if (!sku) { console.warn(`Skipping row ${rowNum}: Missing SKU.`); skippedCount++; return; }
                    if (!location && !reelNumber) { console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Missing Location or Reel Number.`); skippedCount++; return; }
                    if (reelNumber && !location) { /* Allow reels without specific location? Yes */ }

                    // Determine if row represents a reel based on CSV data or reel number presence
                     let isLikelyReelFromCSV = reelNumber || (isReelHeader && ['true', '1', 'yes'].includes(String(row[isReelHeader] || '').toLowerCase()));
                     // Unique identifier for duplicate check within the FILE
                     const fileIdentifier = isLikelyReelFromCSV ? `reel-${reelNumber}` : `sku-${sku}|loc-${location.toLowerCase()}`;
                     if (identifiersInThisImport.has(fileIdentifier)) { console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Duplicate ${isLikelyReelFromCSV ? `Reel# ${reelNumber}` : `SKU/Loc ${location}`} in file.`); skippedCount++; return; }
                     if (isLikelyReelFromCSV && !reelNumber) { console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Reel indicated but Reel Number missing.`); skippedCount++; return; } // Reel needs number
                     identifiersInThisImport.add(fileIdentifier);

                     // --- Find Existing Item or Prepare for New One ---
                      // Use findExistingItemRecord to check against the current inventory state
                      const existingItemRecord = findExistingItemRecord(sku, location, reelNumber);
                      const itemId = existingItemRecord ? existingItemRecord.itemId : DB.generateSimpleId();
                      const wasExisting = !!existingItemRecord; // Track if this row matched an existing DB item

                      // Get the current state from our processing map (or start fresh if new)
                      let currentItemData = processedItemsMap.get(itemId) || {};
                      // If it wasn't in the map yet, but we found an existing record, copy that record's state
                      if (!currentItemData.itemId && wasExisting) {
                          currentItemData = { ...existingItemRecord };
                      }

                     // --- Merge Data (CSV overrides existing/default) ---
                     let newItemDataForRow = { ...currentItemData }; // Clone to modify for this row
                     newItemDataForRow.itemId = itemId;
                     newItemDataForRow.SKU = sku;
                     // Keep existing location/reelNumber if blank in CSV, unless it's a new item
                      newItemDataForRow.location = location || (wasExisting ? currentItemData.location : 'No Location');
                      newItemDataForRow.reelNumber = reelNumber || (wasExisting ? currentItemData.reelNumber : '');

                     // Helper functions for safe merging
                     const isSetInRow = (header) => header && row[header] !== undefined && row[header] !== null && String(row[header]).trim() !== '';
                     const getValue = (header, prop, def) => isSetInRow(header) ? String(row[header]).trim() : (currentItemData[prop] ?? def);
                     const getBooleanValue = (header, prop, def, trueStrings = ['true', '1', 'yes']) => isSetInRow(header) ? trueStrings.includes(String(row[header]).toLowerCase()) : (currentItemData[prop] ?? def);
                     const getNumericValue = (header, prop, def, allowNeg = false) => {
                         if (!isSetInRow(header)) return (currentItemData[prop] ?? def);
                         const num = Number(String(row[header]).trim());
                         return (!isNaN(num) && (allowNeg || num >= 0)) ? num : (currentItemData[prop] ?? def); // Revert to current/default if invalid number
                     };

                      // Description + Change Logging
                      let existingDesc = currentItemData.Description ?? 'No Description';
                      let incomingDesc = isSetInRow(descHeader) ? String(row[descHeader]).trim() : existingDesc;
                      if (wasExisting && existingDesc !== incomingDesc) {
                            console.log(`Description change detected for itemId ${itemId}: "${existingDesc}" -> "${incomingDesc}"`);
                            descChanges++;
                            logTransaction({ // Log immediately
                                type: 'description_change',
                                SKU: sku,
                                itemId: itemId,
                                details: { oldDescription: existingDesc, newDescription: incomingDesc }
                            });
                      }
                      newItemDataForRow.Description = incomingDesc;

                      // Other fields using helpers
                      newItemDataForRow.notes = getValue(notesHeader, 'notes', '');
                      newItemDataForRow.isActive = getBooleanValue(isActiveHeader, 'isActive', true);
                      newItemDataForRow.isReel = isLikelyReelFromCSV || (currentItemData.isReel ?? false); // CSV flag takes precedence
                      newItemDataForRow.footageFactor = getNumericValue(footageFactorHeader, 'footageFactor', null);
                      newItemDataForRow.innerSequence = getValue(innerSeqHeader, 'innerSequence', '');
                      newItemDataForRow.outerSequence = getValue(outerSeqHeader, 'outerSequence', '');
                      newItemDataForRow.innerSequence2 = getValue(innerSeq2Header, 'innerSequence2', '');
                      newItemDataForRow.outerSequence2 = getValue(outerSeq2Header, 'outerSequence2', '');
                      newItemDataForRow.capturedQuantity = getNumericValue(capturedQtyHeader, 'capturedQuantity', null);
                      newItemDataForRow.isTwoWayReel = getBooleanValue(isTwoWayReelHeader, 'isTwoWayReel', false);

                      // Ensure boolean consistency
                      newItemDataForRow.isActive = !!newItemDataForRow.isActive;
                      newItemDataForRow.isReel = !!newItemDataForRow.isReel;
                      newItemDataForRow.isTwoWayReel = newItemDataForRow.isReel && !!newItemDataForRow.isTwoWayReel;

                      // Clean up reel data if not a reel
                      if (!newItemDataForRow.isReel) {
                          newItemDataForRow.reelNumber = '';
                          newItemDataForRow.isTwoWayReel = false;
                          newItemDataForRow.footageFactor = null;
                          newItemDataForRow.innerSequence = ''; newItemDataForRow.outerSequence = '';
                          newItemDataForRow.innerSequence2 = ''; newItemDataForRow.outerSequence2 = '';
                          newItemDataForRow.calculatedFootage = null;
                      }

                     // Preserve existing count state by default, override below based on context/CSV data
                     newItemDataForRow.counted = currentItemData.counted ?? null;
                     newItemDataForRow.isUncounted = currentItemData.isUncounted ?? true;
                     newItemDataForRow.calculatedFootage = currentItemData.calculatedFootage ?? null; // Recalculate based on sequences if provided
                     newItemDataForRow.lastCountTimestamp = currentItemData.lastCountTimestamp ?? null;

                     // --- Determine Count based on Context and CSV ---
                     let countSource = "preserved";
                     const nowTimestamp = new Date().toISOString();

                     // Handle count/sequences based on import context
                     if (importContext === 'update') {
                         // For 'update', CSV count/sequences OVERRIDE existing count state
                         let calculatedFromCSV = null;
                         if (newItemDataForRow.isReel && newItemDataForRow.footageFactor > 0) {
                             // Check if sequences *are provided in this row*
                             const seqProvided1 = isSetInRow(innerSeqHeader) || isSetInRow(outerSeqHeader);
                             const seqProvided2 = newItemDataForRow.isTwoWayReel && (isSetInRow(innerSeq2Header) || isSetInRow(outerSeq2Header));
                             if (seqProvided1 || seqProvided2) {
                                 calculatedFromCSV = calculateFootageForItem(newItemDataForRow, {
                                     inner1: newItemDataForRow.innerSequence, outer1: newItemDataForRow.outerSequence,
                                     inner2: newItemDataForRow.innerSequence2, outer2: newItemDataForRow.outerSequence2
                                 });
                                 newItemDataForRow.calculatedFootage = calculatedFromCSV; // Store calculation result
                                 if (calculatedFromCSV !== null) {
                                     newItemDataForRow.counted = calculatedFromCSV;
                                     newItemDataForRow.isUncounted = false;
                                     newItemDataForRow.lastCountTimestamp = nowTimestamp;
                                     countSource = "csv_sequences_update";
                                 } else {
                                     console.warn(`Row ${rowNum} (SKU ${sku}): Invalid sequences provided. Preserving previous count state.`);
                                     // Keep previous counted/isUncounted state
                                     countSource = "preserved_invalid_sequences";
                                 }
                             }
                             // If sequences NOT provided in row, preserve existing state
                         }

                         // If count wasn't set by sequences, check explicit 'counted' column
                         if (countSource !== "csv_sequences_update" && isSetInRow(countHeader)) {
                              const csvCount = Number(String(row[countHeader]).trim());
                              if (!isNaN(csvCount) && csvCount >= 0) {
                                 newItemDataForRow.counted = csvCount;
                                 newItemDataForRow.isUncounted = false;
                                 newItemDataForRow.lastCountTimestamp = nowTimestamp;
                                 newItemDataForRow.calculatedFootage = null; // Clear calc if manual count provided
                                 countSource = "csv_count_update";
                              } else {
                                   console.warn(`Row ${rowNum} (SKU ${sku}): Invalid count value '${row[countHeader]}'. Preserving previous count state.`);
                              }
                         }
                         // If neither valid sequences nor count provided, state remains preserved

                     } else if (importContext === 'new_count' || importContext === 'recount') {
                         // For new cycles or recounts, ALWAYS reset the count state
                         newItemDataForRow.counted = null;
                         newItemDataForRow.isUncounted = true;
                         newItemDataForRow.calculatedFootage = null; // Clear calculated footage
                         newItemDataForRow.lastCountTimestamp = nowTimestamp; // Update timestamp for cycle start
                         countSource = "reset_for_cycle";
                         // We keep sequences from CSV as 'captured' data but don't calculate count from them
                     }

                    // --- Handle Flags based on Context ---
                     newItemDataForRow.toCount = currentItemData.toCount ?? false; // Preserve existing by default
                     newItemDataForRow.currentRecountBatchId = currentItemData.currentRecountBatchId ?? null; // Preserve existing

                     if (importContext === 'new_count') {
                         // Mark item as needing count for this cycle
                         if (!newItemDataForRow.toCount) itemsMarkedToCount++; // Count how many were newly marked
                         newItemDataForRow.toCount = true;
                         newItemDataForRow.currentRecountBatchId = null; // Ensure not marked for recount
                     } else if (importContext === 'recount') {
                          // Add item to the specified recount batch
                          if (newItemDataForRow.currentRecountBatchId !== recountBatchId) itemsAddedToRecount++; // Count items newly added to *this* batch
                          newItemDataForRow.currentRecountBatchId = recountBatchId;
                          newItemDataForRow.toCount = false; // Ensure not marked for general count
                     }
                    

                    // --- Update the map with the processed data ---
                    // Apply defaults just before saving to map (catches any missed nulls/undefined)
                    const finalItemDataArray = applyDataDefaults([newItemDataForRow]);
                     if (finalItemDataArray && finalItemDataArray.length > 0) {
                         processedItemsMap.set(itemId, finalItemDataArray[0]);
                         if (wasExisting) {
                             importUpdatedCount++;
                         } else {
                             importAddedCount++;
                         }
                     } else {
                         console.error(`Row ${rowNum} (SKU ${sku}): Failed to apply defaults. Skipping.`);
                         skippedCount++;
                         identifiersInThisImport.delete(fileIdentifier); // Remove from set if skipped
                         processedItemsMap.delete(itemId); // Ensure invalid data isn't kept
                     }
                }); // End forEach row


                // --- Post-Processing & Saving ---
                let finalInventory = Array.from(processedItemsMap.values());
                let markedNotToCount = 0;

                // If starting a NEW count cycle, find items NOT in the import and mark them as toCount=false
                if (importContext === 'new_count') {
                    database.inventory.forEach(existingItem => {
                        if (!processedItemsMap.has(existingItem.itemId)) {
                            // This item exists in DB but wasn't in the import CSV
                            if (existingItem.toCount) {
                                markedNotToCount++;
                                existingItem.toCount = false; // Mark as not part of the new cycle
                                existingItem.lastCountTimestamp = new Date().toISOString(); // Timestamp the change
                                // Add this modified item back to the final list
                                finalInventory.push(existingItem);
                            }
                        }
                    });
                     console.log(`New Count Cycle Import: Marked ${markedNotToCount} existing items (not in CSV) as NOT 'toCount'.`);
                }

                 // Assign the newly constructed array to the global state
                 database.inventory = finalInventory;
                 console.log(`In-memory database.inventory updated. Final Size: ${database.inventory.length}`);


                // --- Save all changes to DB ---
                 if (importAddedCount > 0 || importUpdatedCount > 0 || markedNotToCount > 0 || itemsAddedToRecount > 0) {
                     try {
                          console.log("Saving updated inventory to IndexedDB...");
                          await DB.saveInventory(database.inventory);
                          console.log("Inventory saved successfully.");
                     } catch (saveError) {
                         console.error("Critical error saving inventory after import:", saveError);
                         throw new Error(`Failed to save changes to database: ${saveError.message}`);
                     }
                 } else {
                     console.log("No changes to inventory required saving.");
                 }


                // --- Log Import Transaction ---
                 let logDetails = {
                     fileName: file.name,
                     addedCount: importAddedCount,
                     updatedCount: importUpdatedCount,
                     skippedCount: skippedCount,
                     descChanges: descChanges,
                     skusImported: identifiersInThisImport.size // Count of unique identifiers processed from file
                 };
                 let logType = 'import_csv'; // Default context: update

                 if (importContext === 'new_count') {
                     logType = 'new_count_started_import';
                     logDetails.itemsMarkedToCount = itemsMarkedToCount;
                     logDetails.markedNotToCount = markedNotToCount;
                 } else if (importContext === 'recount') {
                     logType = 'recount_items_imported';
                     logDetails.recountBatchId = recountBatchId;
                     logDetails.itemsAddedToRecount = itemsAddedToRecount;
                 }

                 if (importAddedCount > 0 || importUpdatedCount > 0 || skippedCount > 0 || markedNotToCount > 0 || itemsAddedToRecount > 0) {
                    await logTransaction({ type: logType, details: logDetails });
                 }


                // --- Refresh UI ---
                console.log("Applying filters and updating UI after import...");
                applyCurrentFilters(); // Use the CORE filter function
                updateSummaryCards();


                // --- User Feedback ---
                 let message = `Import complete (Context: ${importContext})!`;
                 message += `\nFile Records Processed: ${identifiersInThisImport.size}`;
                 message += `\nItems Added to DB: ${importAddedCount}`;
                 message += `\nItems Updated in DB: ${importUpdatedCount}`;
                 if (importContext === 'new_count') {
                     message += `\nItems Newly Marked 'To Count': ${itemsMarkedToCount}`;
                     message += `\nExisting Items Marked NOT 'To Count': ${markedNotToCount}`;
                 }
                 if (importContext === 'recount') {
                     message += `\nItems Added/Moved to Recount Batch '${recountBatchId}': ${itemsAddedToRecount}`;
                 }
                 if (descChanges > 0) message += `\nDescription Changes Logged: ${descChanges}`;
                 if (skippedCount > 0) message += `\nRows Skipped (Missing data/Duplicate in file): ${skippedCount}`;
                 message += "\n(Check console for detailed warnings)";

                 alert(message);


            } catch (processingError) {
                 console.error("Error processing imported CSV data:", processingError);
                 alert(`Error processing CSV data: ${processingError.message}\nOperation cancelled.`);
                 // Attempt to restore previous state? Risky. Maybe just refresh UI.
                 applyCurrentFilters();
                 updateSummaryCards();
            }

        } catch (error) { // Catches file read or PapaParse errors
            console.error('Error processing CSV:', error);
            alert('Error importing CSV: ' + error.message);
        } finally {
            // Clean up the temporary file input element
            if (input && input.parentNode) {
                input.parentNode.removeChild(input);
            }
        }
    }; // end input.onchange

    document.body.appendChild(input);
    input.click();
}

// Helper to read file content as text
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = (event) => reject(new Error(`File could not be read: ${event.target.error}`));
        reader.readAsText(file); // Consider specifying encoding if needed, e.g., 'UTF-8'
    });
}


// --- Exports ---
function exportCSV(data) {
    try {
        if (!data || data.length === 0) {
            alert("No inventory data to export.");
            return;
        }

        // Define headers explicitly including all relevant fields
        const headers = [
            "itemId", // Unique persistent ID (Good for re-import matching)
            "SKU", "Description", "location", "reelNumber", // Core identifiers
            "counted", "isUncounted", "lastCountTimestamp", // Current count state
            "capturedQuantity", // Expected/Historical Qty
            "isActive", "isReel", "isTwoWayReel", // Status & Type
            "footageFactor", // Reel specific
            "innerSequence", "outerSequence", // Seq 1
            "innerSequence2", "outerSequence2", // Seq 2
            "calculatedFootage", // Reel specific result
            "toCount", // Flag for current cycle
            "currentRecountBatchId", // Recount tracking
            "notes" // Metadata
        ];

        const csv = Papa.unparse({
            fields: headers,
             // Map data, ensuring null/undefined are exported as empty strings for compatibility
             data: data.map(item => {
                 const row = {};
                 headers.forEach(header => {
                     // Handle boolean true/false explicitly for clarity in CSV
                     if (typeof item[header] === 'boolean') {
                         row[header] = item[header] ? 'TRUE' : 'FALSE';
                     } else {
                         row[header] = item[header] ?? ''; // Use empty string for null/undefined
                     }
                 });
                 return row;
             })
        }, {
            header: true,
            newline: "\r\n" // Standard CSV newline
        });

        const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }); // Add BOM for Excel compatibility
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().slice(0, 10);
        link.setAttribute("href", url);
        link.setAttribute("download", `telecom_inventory_export_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log("CSV export initiated.");

    } catch (error) {
        console.error("Error generating or exporting CSV:", error);
        alert(`Failed to export CSV: ${error.message}. Check console for details.`);
    }
}

function exportPDF(data) {
    try {
        // Check for jsPDF and AutoTable plugin
        if (typeof jspdf === 'undefined' || typeof jspdf.jsPDF === 'undefined') throw new Error("jsPDF library not found.");
        if (typeof jspdf.jsPDF.API?.autoTable !== 'function') throw new Error("jsPDF AutoTable plugin not found.");

        // Export based on the *currently displayed* filtered data (currentInventory)
        const dataToExport = currentInventory;
        if (!dataToExport || dataToExport.length === 0) {
            alert("No inventory data matching current filters to export to PDF.");
            return;
        }

        const { jsPDF } = jspdf;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
        const timestamp = new Date().toLocaleString();
        const user = getUserIdentifier();

        // Construct filter description string dynamically
        let filterParts = [];
         if (currentFilters.location) filterParts.push(`Loc: "${currentFilters.location}"`);
         if (currentFilters.searchTerm) filterParts.push(`Search: "${currentFilters.searchTerm}"`);
         filterParts.push(`Status: "${currentFilters.status}"`);
         switch (currentFilters.filterByToCountStatus) {
             case 'counted': filterParts.push("View: Finished"); break;
             case 'to_count': filterParts.push("View: To Count"); break;
             case 'all': filterParts.push("View: All"); break;
         }
        const filterDesc = `Filters: ${filterParts.join(', ')}`;


        // Define columns for the PDF table
        const columns = [
            { header: 'SKU', dataKey: 'SKU' },
            { header: 'Description', dataKey: 'Description' },
            { header: 'Location', dataKey: 'location' },
            { header: 'Reel#', dataKey: 'reelNumber' }, // Add Reel Number
            { header: 'Qty', dataKey: 'displayQty' }, // Use calculated display value
            { header: 'Status', dataKey: 'displayStatus' }, // Combined status
            { header: 'Notes', dataKey: 'notes' },
        ];

        // Prepare rows with calculated display values
        const rows = dataToExport.map(item => {
            let displayStatus = item.isActive ? (item.toCount ? 'To Count' : 'Finished') : 'Inactive';
            if (item.isUncounted && item.toCount) displayStatus = 'Flagged'; // Indicate if flagged

            let displayQty = item.counted ?? (item.isUncounted ? '---' : '0');
             if (item.calculatedFootage !== null) displayQty = `${item.calculatedFootage.toFixed(2)} ft`;

            return {
                SKU: item.SKU ?? '',
                Description: item.Description ?? '',
                location: item.location ?? '',
                reelNumber: item.reelNumber ?? '', // Add reel number data
                displayQty: displayQty,
                displayStatus: displayStatus,
                notes: item.notes ?? '',
            };
        });

        // Add title and metadata
        doc.setFontSize(16);
        doc.text("Telecom Inventory Report", 40, 40);
        doc.setFontSize(10);
        doc.text(`Generated: ${timestamp} by ${user}`, 40, 55);
        doc.text(filterDesc, doc.internal.pageSize.getWidth() - 40, 55, { align: 'right'});

        // Generate table using AutoTable
        doc.autoTable({
            columns: columns,
            body: rows,
            startY: 70,
            theme: 'grid', // 'striped', 'grid', 'plain'
            headStyles: { fillColor: [44, 62, 80] }, // Dark blue header
            styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' }, // Use linebreak for overflow
            columnStyles: {
                SKU: { cellWidth: 80 },
                Description: { cellWidth: 170 },
                location: { cellWidth: 70 },
                reelNumber: { cellWidth: 60 }, // Width for reel number
                displayQty: { cellWidth: 50, halign: 'right' },
                displayStatus: { cellWidth: 50, halign: 'center' },
                notes: { cellWidth: 'auto' }, // Let notes take remaining space
            },
             didDrawPage: function (data) { // Add footer with page number
                 let footerStr = "Page " + doc.internal.getNumberOfPages();
                 doc.setFontSize(8);
                 doc.text(footerStr, data.settings.margin.left, doc.internal.pageSize.getHeight() - 10);
             }
        });

        const filenameTimestamp = new Date().toISOString().slice(0, 10);
        doc.save(`telecom_inventory_report_${filenameTimestamp}.pdf`);
        console.log("PDF export initiated based on current filters.");

    } catch (error) {
        console.error("Error generating or exporting PDF:", error);
        alert(`Failed to export PDF: ${error.message}. Check console for details.`);
    }
}


// --- Action Implementations ---

// MODIFIED: Now triggers a specific import process with 'new_count' context
function startNewCount() {
    if (confirm("This action requires importing a CSV file containing the SKUs for the NEW count cycle.\n\n- Items in the CSV will be marked 'To Count'.\n- Existing items NOT in the CSV will be marked as NOT 'To Count' and hidden from the default view.\n- Count/Sequence data in this import is IGNORED (counts are reset).\n\nProceed to select CSV file?")) {
        console.log("Starting new count cycle: Initiating specific CSV import with 'new_count' context.");
        showImportDialog('new_count'); // Pass the string 'new_count'
    } else {
        console.log("Start new count cycle cancelled by user.");
    }
}

// Helper function to show export options before finalizing
async function showExportOptionsDialog() {
    return new Promise((resolve) => {
        // Simple prompt for now, replace with a modal for better UX
        const choice = prompt("Export before finalizing?\nOptions:\n1. CSV Only (All Items)\n2. PDF Only (Current Filtered View)\n3. Both CSV and PDF\n4. Cancel Finalization\n\nEnter number (1-4):", "3");

        let exportCSVFlag = false;
        let exportPDFFlag = false;
        let proceed = false;

        switch (choice) {
            case '1':
                exportCSVFlag = true;
                proceed = true;
                break;
            case '2':
                exportPDFFlag = true;
                proceed = true;
                break;
            case '3':
                exportCSVFlag = true;
                exportPDFFlag = true;
                proceed = true;
                break;
            case '4':
            default: // Treat null (cancel button) or invalid input as cancel
                proceed = false;
                break;
        }

        if (proceed) {
             console.log(`Export choice: CSV=${exportCSVFlag}, PDF=${exportPDFFlag}`);
             try {
                if (exportCSVFlag) {
                    console.log("Initiating CSV export of ALL data...");
                    exportCSV(database.inventory); // Export ALL data before finalization changes
                }
                if (exportPDFFlag) {
                     console.log("Initiating PDF export of CURRENTLY FILTERED data...");
                     // PDF Export uses 'currentInventory' which reflects the current filter state.
                     exportPDF(currentInventory);
                }
                 // Allow async time for potential file saves before resolving
                 setTimeout(() => resolve({ proceed: true }), 500); // Small delay
             } catch (exportError) {
                 console.error("Export failed during finalization prompt:", exportError);
                 alert(`Export failed: ${exportError.message}\n\nFinalization cancelled.`);
                 resolve({ proceed: false }); // Indicate cancel due to error
             }
        } else {
            console.log("Finalization cancelled by user at export prompt.");
            resolve({ proceed: false }); // Indicate cancel
        }
    });
}


async function finalizeInventory() {
    // 1. Prompt for Export first
    const exportResult = await showExportOptionsDialog();
    if (!exportResult || !exportResult.proceed) {
        return; // Stop if user cancelled or export failed
    }
    console.log("Export step completed or skipped. Proceeding with finalization confirmation.");

    // 2. Confirm Finalization
    if (confirm("FINAL WARNING:\n\nThis action will:\n- Mark ACTIVE REELS with zero or null quantity as INACTIVE.\n- Clear the 'To Count' flag for ALL items, hiding them from the default view until the next cycle.\n\nThis cannot be easily undone.\n\nAre you sure you want to finalize this inventory count?")) {
        console.log("User confirmed finalization.");
        const finalizeTimestamp = new Date().toISOString();
        let deactivatedReelCount = 0;
        let toCountClearedCount = 0;
        let itemsToSave = []; // Collect items that need saving

        database.inventory.forEach(item => {
            let modified = false;
            // --- Deactivate applicable reels ---
            if (item.isActive && item.isReel && (item.counted === null || item.counted === 0)) {
                item.isActive = false;
                item.lastCountTimestamp = finalizeTimestamp; // Record timestamp of status change
                deactivatedReelCount++;
                modified = true;
                // Log immediately within the loop? Or collect and log later? Log later is cleaner.
            }

            // --- Clear 'toCount' flag ---
             if (item.toCount) {
                 item.toCount = false;
                 toCountClearedCount++;
                 modified = true;
             }
             if (modified) {
                itemsToSave.push(item.itemId); // Add itemId to list needing save
             }
        });

        // Log the summary finalization event
        await logTransaction({
            type: 'inventory_finalized',
            details: {
                deactivatedReelCount: deactivatedReelCount,
                toCountClearedCount: toCountClearedCount
            }
        });
        console.log(`Inventory finalized. ${deactivatedReelCount} reels marked as inactive. ${toCountClearedCount} items had 'toCount' flag cleared.`);

        // Log individual status changes for deactivated reels
        database.inventory.forEach(item => {
             if (itemsToSave.includes(item.itemId) && !item.isActive && item.isReel && deactivatedReelCount > 0) {
                  // Check if this item was one of the reels deactivated in this run
                   if (item.lastCountTimestamp === finalizeTimestamp) {
                      logTransaction({
                          type: 'status_change',
                          SKU: item.SKU,
                          itemId: item.itemId,
                          location: item.location,
                          details: {
                              newStatus: false, // Inactive
                              reason: `Finalized REEL with ${item.counted === null ? 'null' : 'zero'} quantity`
                          }
                      }); // No need to await this log individually
                   }
             }
        });


        // Autosave changes (saves the entire inventory array which now includes modifications)
        if (itemsToSave.length > 0) {
            try {
               console.log("Saving finalized inventory state...");
               await autoSave();
               console.log("Finalized state saved.");
            } catch(e) {
                console.error("Autosave failed after finalizing inventory:", e);
                alert("Finalization logic applied, but failed to save changes. Please check console and maybe export manually again.");
                // Don't proceed with UI updates if save failed? Or proceed cautiously? Let's proceed for now.
            }
        } else {
             console.log("No items required state changes during finalization.");
        }


        // Re-filter (should now show nothing in 'to_count' view) and update UI
        applyCurrentFilters();
        updateSummaryCards();
        alert(`Inventory finalized.\n- ${deactivatedReelCount} reels marked as inactive.\n- ${toCountClearedCount} items cleared from the current count view.\nReady for next cycle.`);

    } else {
        console.log("Inventory finalization cancelled by user.");
    }
}


// --- END OF FILE appLogic.js ---
