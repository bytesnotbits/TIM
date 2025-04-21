// --- START OF FILE appLogic.js ---

// Check if required libraries are loaded
if (typeof Papa === 'undefined') {
    console.error("PapaParse library not found. Please include papaparse.min.js.");
    alert("Error: CSV library not loaded. CSV features will not work.");
  }
  // Defer PDF library check until export function is called
  
  // --- Global State ---
  let database = { inventory: [], transactionHistory: [] };
  let currentFilters = { location: null, status: 'active', searchTerm: '' }; // Add searchTerm
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

        // --- Basic Info ---
        item.SKU = item.SKU ?? 'UNKNOWN_SKU';
        item.Description = item.Description ?? 'No Description';
        item.location = item.location ?? 'No Location';
    });
    console.log("Applied data defaults (including toCount, reelNumber) to inventory items.");
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
          applyCurrentFilters(); // Apply default filters ('active')
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
        // No closing brace here anymore
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', debounce(wrapHandler(() => {
                applyCurrentFilters();
            }, 'search input'), 300));
        }

        // Define debounce function (still okay to define it here for now)
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

        // Filters
        document.getElementById('apply-filters-btn')?.addEventListener('click', wrapAction(applyCurrentFilters, 'apply filters'));
        document.getElementById('clear-filters-btn')?.addEventListener('click', wrapAction(clearAllFilters, 'clear filters'));
        document.getElementById('locationFilterInput')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') wrapAction(applyCurrentFilters, 'apply filters')();
        });
        document.getElementById('statusFilterSelect')?.addEventListener('change', wrapAction(applyCurrentFilters, 'apply filters'));


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
        console.log("Event listeners successfully set up."); // This should now be reached if no other errors occur
    } catch (error) {
        console.error("Error setting up event listeners:", error); // Catch block remains for other potential errors
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
          }
      };
  }
  
  
  // --- Event Delegation Handlers ---
  function handleInventoryListClick(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId; // <-- GET itemId
    const sku = itemDiv.dataset.sku;       // <-- Keep SKU for history view if needed

// In handleInventoryListClick function:
// ... (inside the 'else if' block for view-history)
if (!sku) { // Keep SKU check for title potentially
    console.error("Could not find SKU on inventory item div for history title:", itemDiv);
    // Don't return yet if itemId exists
}
if (!itemId) { // Add itemId check
     console.error("Could not find ItemID on inventory item div for history:", itemDiv);
     alert("Error: Could not retrieve ItemID to show history.");
     return;
}
    if (target.matches('button[data-action="flag"]')) {
        flagUncounted(itemId); // <-- PASS itemId
    } else if (target.matches('button[data-action="view-history"]')) {
        // showItemHistory is designed to work by SKU to find related history
        if (!sku) {
             console.error("Could not find SKU on inventory item div for history:", itemDiv);
             return;
        }
        showItemHistory(sku); // <-- Pass SKU as originally intended
    }
}

// --- Event Delegation Handlers ---
function handleInventoryListClick(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId; // <-- GET itemId
    const sku = itemDiv.dataset.sku;       // <-- Keep SKU for history view if needed
  
    console.log("[handleInventoryListClick] Click detected on itemDiv:", itemDiv); // DEBUG LOG
    console.log("[handleInventoryListClick] Extracted itemId:", itemId, "SKU:", sku); // DEBUG LOG
    console.log("[handleInventoryListClick] Clicked target element:", target); // DEBUG LOG
  
    // Add a check to ensure itemId was found
    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }
  
    if (target.matches('button[data-action="flag"]')) {
        console.log("[handleInventoryListClick] 'Flag' button matched."); // DEBUG LOG
        flagUncounted(itemId); // <-- PASS itemId
    } else if (target.matches('button[data-action="view-history"]')) {
        console.log("[handleInventoryListClick] 'View History' button matched."); // DEBUG LOG
        // showItemHistory is designed to work by SKU to find related history
        if (!sku) {
             console.error("Could not find SKU on inventory item div for history:", itemDiv);
             alert("Error: Could not retrieve SKU to show history."); // User feedback
             return;
        }
        // *** CHANGE: Pass itemId instead of sku ***
      console.log(`[handleInventoryListClick] Calling showItemHistory with ItemID: ${itemId} (SKU: ${sku} for title)`); // DEBUG LOG
      try {
        showItemHistory(itemId, sku); // Pass both: itemId for query, sku for title
      } catch (historyError) {
        console.error(`[handleInventoryListClick] Error directly calling showItemHistory:`, historyError);
        alert(`An error occurred trying to display history for ItemID ${itemId}.`);
      }
    } else {
        console.log("[handleInventoryListClick] No matching action button found for click target."); // DEBUG LOG
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

    if (target.matches('input[data-type="count-input"]:not(:disabled)')) {
        updateCount(itemId, target.value); // <-- PASS itemId
    } else if (target.matches('input[data-sequence]')) { // Matches inner, outer, inner2, outer2
        updateSequences(itemId); // <-- PASS itemId
    }
}

function handleInventoryListInput(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId; // <-- GET itemId

    // Add a check to ensure itemId was found
    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

     if (target.matches('textarea[data-type="notes-input"]')) {
        // Use a debounce mechanism if performance becomes an issue on rapid typing
        updateItemNotes(itemId, target.value); // <-- PASS itemId
    }
}
  
  
  // --- Data Persistence (autoSave) ---
  async function autoSave() {
    try {
      if (!DB.connection) {
          console.warn("DB connection not ready for autosave. Attempting init.");
          await DB.init();
      }
      const results = await Promise.allSettled([
           DB.saveInventory(database.inventory),
           DB.saveTransactionHistory(database.transactionHistory)
       ]);
  
      let saveError = false;
      if (results[0].status === 'rejected') {
          console.error("Auto-save failed for inventory:", results[0].reason);
          saveError = true;
      }
       if (results[1].status === 'rejected') {
          console.error("Auto-save failed for transaction history:", results[1].reason);
          saveError = true;
      }
  
      if (!saveError) {
          console.log("Autosave completed to IndexedDB.");
      } else {
           console.warn("Autosave failed for one or more data stores.");
      }
  
    } catch (error) {
      console.error("Unexpected error during auto-save process:", error);
    }
  }
  
  // --- Audit Trail ---
  function logTransaction(transactionData) {
      try {
          const timestamp = new Date().toISOString();
          const user = getUserIdentifier();
  
          const fullTransaction = {
              timestamp: timestamp,
              user: user,
              ...transactionData // Includes type, SKU, details etc.
          };
  
          database.transactionHistory.unshift(fullTransaction); // Add to beginning for easy display reverse-chrono
          console.log("Transaction logged:", fullTransaction);
  
          // Update global history view if visible
          if (document.getElementById('history-view')?.style.display !== 'none') {
              try {
                  renderHistoryView();
              } catch (renderError) {
                   console.error("Error rendering history view after logging transaction:", renderError);
              }
          }
          // No need to re-render item history modal here, it fetches fresh data when opened
  
      } catch (error) {
          console.error("Error creating or logging transaction:", error);
      }
  }
  
  
  // --- State Update Helper ---
/* Renamed from refreshCurrentInventory to better reflect its action
Added the toCount check to the filter logic. */
function applyCurrentFilters() {
    try {
        // Get filter values from UI
        const locationInput = document.getElementById('locationFilterInput');
        const statusSelect = document.getElementById('statusFilterSelect');
        const searchInput = document.getElementById('searchInput'); // Get search input

        currentFilters.location = locationInput ? locationInput.value.trim().toLowerCase() : null;
        currentFilters.status = statusSelect ? statusSelect.value : 'active';
        currentFilters.searchTerm = searchInput ? searchInput.value.trim().toLowerCase() : ''; // Get and store search term

        console.log("Applying filters:", currentFilters);

        // --- Primary Filtering (Location, Status, ToCount) ---
        let filteredInventory = database.inventory.filter(item => {
            const locationMatch = !currentFilters.location || (item.location && item.location.toLowerCase().includes(currentFilters.location));
            const statusMatch = currentFilters.status === 'all' ||
                                (currentFilters.status === 'active' && item.isActive) ||
                                (currentFilters.status === 'inactive' && !item.isActive);
            const toCountMatch = item.toCount === true; // Still filter by toCount initially

            return locationMatch && statusMatch && toCountMatch;
        });

        // --- Secondary Filtering (Search Term) ---
        if (currentFilters.searchTerm) {
            filteredInventory = filteredInventory.filter(item => {
                const skuMatch = item.SKU && item.SKU.toLowerCase().includes(currentFilters.searchTerm);
                const descMatch = item.Description && item.Description.toLowerCase().includes(currentFilters.searchTerm);
                const reelNumMatch = item.reelNumber && item.reelNumber.toLowerCase().includes(currentFilters.searchTerm);
                return skuMatch || descMatch || reelNumMatch;
            });
            console.log(`Applied search term "${currentFilters.searchTerm}", ${filteredInventory.length} items remain.`);
        }

        // Assign to currentInventory and sort
        currentInventory = filteredInventory;
        currentInventory.sort((a, b) => (a.SKU || '').localeCompare(b.SKU || ''));

        // Re-render the list
        renderInventoryList(); // This function needs to handle the "no items match" message correctly
        // Note: We'll address searching the *full* database for the "Add to Count" feature separately.

    } catch (error) {
        console.error("Error applying filters or refreshing current inventory:", error);
        currentInventory = []; // Fallback to empty on error
        renderInventoryList(); // Render the empty state or error message
    }
}

// Update clearAllFilters to clear search
function clearAllFilters() {
    const locationInput = document.getElementById('locationFilterInput');
    const statusSelect = document.getElementById('statusFilterSelect');
    const searchInput = document.getElementById('searchInput'); // Get search input
    if (locationInput) locationInput.value = '';
    if (statusSelect) statusSelect.value = 'active'; // Reset status to active
    if (searchInput) searchInput.value = ''; // Clear search input

    // Update global state and re-apply/render
    currentFilters.location = null;
    currentFilters.status = 'active';
    currentFilters.searchTerm = ''; // Clear search term state
    applyCurrentFilters(); // Re-run filter logic and render
}
  
  
  // --- Core Logic Functions ---
  
// --- Core Data Access (Refactored for itemId) ---

// Finds a specific item-location record by its unique ID
async function findInventoryItemByItemId(itemId) {
    if (!itemId) {
        console.warn("findInventoryItemByItemId called with null or undefined itemId.");
        return null;
    }
    // In-memory find (database is the source of truth, appLogic uses the loaded copy)
    const item = database.inventory.find(item => item.itemId === itemId);
    if (!item) {
         // Attempt to reload from DB if not found in memory? Could indicate stale data.
         // For now, just return null if not in current memory state.
         // console.warn(`Item with itemId ${itemId} not found in memory state.`);
    }
    return item || null;
}

// Finds all item-location records for a given SKU
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
// This is often needed for imports or user lookups before knowing itemId
function findExistingItemRecord(sku, location = null, reelNumber = null) {
     if (!sku) return null;
     const searchSKU = String(sku).trim();
     const searchLoc = location ? String(location).trim().toLowerCase() : null;
     const searchReel = reelNumber ? String(reelNumber).trim() : null;

     if (searchReel) {
         // Reels are uniquely identified by reelNumber (assumption based on import logic)
         return database.inventory.find(item => item.isReel && item.reelNumber === searchReel);
     } else if (searchLoc) {
         // Non-reels are unique by SKU + Location
         return database.inventory.find(item =>
             !item.isReel && // Important: only match non-reels this way
             String(item.SKU).trim() === searchSKU &&
             String(item.location).trim().toLowerCase() === searchLoc
         );
     } else {
          console.warn(`findExistingItemRecord called for SKU ${searchSKU} without location or reelNumber.`);
          // Cannot reliably find a unique item without location/reel#
          return null;
     }
}
  
  // Records the count, handles logging and saving
// --- Core Data Modification (Refactored for itemId) ---

// Records the physical count OR updates count via adjustment, logs, saves
async function recordOrUpdateCount(itemId, newQuantity, source, details = {}) {
    // source: 'manual_count', 'sequence_calc', 'recount_adjustment'
    // details: object containing relevant info like old value, notes, adjustmentTxId, etc.
    if (itemId === null || itemId === undefined) {
        console.error("recordOrUpdateCount: itemId is missing.");
        return null;
    }
     if (newQuantity === null || newQuantity === undefined || typeof newQuantity !== 'number' || isNaN(newQuantity) || newQuantity < 0) {
          console.error(`recordOrUpdateCount: Invalid newQuantity (${newQuantity}) for itemId ${itemId}.`);
          // Should we revert UI or just log error? Log error for now.
          return null;
     }

    try {
        const item = await findInventoryItemByItemId(itemId); // Use await if it becomes async
        if (!item) {
            console.error(`Item with itemId ${itemId} not found for recording count.`);
            return null;
        }
        // Don't allow updates on inactive items (except maybe reactivation?)
        if (!item.isActive) {
             console.warn(`Attempted to update count for inactive item ${itemId} (SKU: ${item.SKU}, Loc: ${item.location}).`);
             return null;
        }

        const previousCount = item.counted;
        const previousFlag = item.isUncounted;
        const previousTimestamp = item.lastCountTimestamp;
        const isCurrentlyRecount = item.currentRecountBatchId !== null; // Check if in recount

        // No change needed if quantity is identical AND state isn't changing from uncounted
        if (previousCount === newQuantity && previousFlag === false && source !== 'recount_adjustment') {
             // Allow recount adjustments even if quantity doesn't change overall count
             console.log(`Count for ${itemId} is already ${newQuantity}. No change recorded (source: ${source}).`);
             return item;
        }

        // Update item state
        item.counted = newQuantity;
        item.isUncounted = false; // Explicitly has a count value now
        item.lastCountTimestamp = new Date().toISOString();
        // If the update source was sequence calculation, store that result
        if (source === 'sequence_calc') {
             item.calculatedFootage = newQuantity;
        } else if (source !== 'recount_adjustment') {
            // Clear calculated footage if manually counted or flagged uncounted
            item.calculatedFootage = null;
        }
        // Note: We don't modify item.notes here unless passed in details

        // Log the transaction
        const logEntry = {
            type: 'update_count', // Default type
            itemId: item.itemId,
            SKU: item.SKU,
            location: item.location,
            user: getUserIdentifier(), // Get current user
            timestamp: item.lastCountTimestamp, // Use the same timestamp
            details: {
                source: source, // 'manual_count', 'sequence_calc', 'recount_adjustment'
                oldValue: previousCount,
                newValue: newQuantity,
                wasUncounted: previousFlag,
                ...details // Add any source-specific details (notes, txId, etc.)
            }
        };

        // Adjust log type if it's part of a recount
         if (isCurrentlyRecount) {
             logEntry.type = source === 'recount_adjustment' ? 'recount_adjustment_update' : 'recount_physical_update';
             logEntry.details.recountBatchId = item.currentRecountBatchId;
         }

        // Use the DB.addTransaction function now
        try {
             await DB.addTransaction(logEntry);
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
        if (item.isUncounted === true && item.counted === null) { return; } // No change needed

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
              await DB.addTransaction(logEntry);
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

// Called by event handler on main count input change
async function updateCount(itemId, quantityStr) {
    const quantity = Number(quantityStr);
     if (isNaN(quantity) || quantity < 0) {
         alert("Invalid quantity entered. Please enter a non-negative number.");
         // Re-render needed to reset the input value visually
         const item = await findInventoryItemByItemId(itemId); // Get item data
         if (item) {
             renderInventoryList(); // TODO: Optimize later to re-render only the specific item/group
         }
         return;
     }

    // Use recordOrUpdateCount for logging/saving
    const updatedItem = await recordOrUpdateCount(itemId, quantity, 'manual_count', { /* no extra details needed */ });

    if (updatedItem) {
        applyCurrentFilters(); // Re-filter and render
        updateSummaryCards();
    } else {
        // Handle case where recordCount failed (already logged error)
        console.warn(`Update count for ${itemId} did not result in a saved change.`);
        // Re-render to potentially reset input if needed
         renderInventoryList(); // TODO: Optimize later
    }
}

// Calculates footage based on sequences FOR A SPECIFIC ITEM OBJECT
// Doesn't modify item state directly, just returns calculated value or null
function calculateFootageForItem(item, sequences) {
     // sequences = { inner1, outer1, inner2, outer2 }
      if (!item || !item.isReel || typeof item.footageFactor !== 'number' || isNaN(item.footageFactor) || item.footageFactor <= 0) {
            // Not a reel or invalid factor
            return null;
        }

        try {
            let totalFootage = 0;
            let calculationPossible = false;

            // First pair
            const inner1Str = String(sequences.inner1 || '').trim();
            const outer1Str = String(sequences.outer1 || '').trim();
            if (inner1Str !== '' && outer1Str !== '') { // Only calculate if BOTH are entered
                const inner1 = Number(inner1Str);
                const outer1 = Number(outer1Str);
                if (!isNaN(inner1) && !isNaN(outer1) && outer1 >= inner1) {
                    totalFootage += Math.abs(outer1 - inner1); // Use abs just in case
                    calculationPossible = true;
                } else {
                    console.warn(`Invalid sequence pair 1 for itemId ${item.itemId}: Inner=${inner1Str}, Outer=${outer1Str}`);
                    return null; // Invalidate calculation if any pair is entered but invalid
                }
            } else if (inner1Str !== '' || outer1Str !== '') {
                 // Only one sequence entered - invalid for calculation
                 console.warn(`Incomplete sequence pair 1 for itemId ${item.itemId}: Inner=${inner1Str}, Outer=${outer1Str}`);
                 return null;
            }


            // Second pair (only if two-way reel and sequences are present)
            if (item.isTwoWayReel) {
                 const inner2Str = String(sequences.inner2 || '').trim();
                 const outer2Str = String(sequences.outer2 || '').trim();
                 if (inner2Str !== '' && outer2Str !== '') { // Only calculate if BOTH are entered
                    const inner2 = Number(inner2Str);
                    const outer2 = Number(outer2Str);
                    if (!isNaN(inner2) && !isNaN(outer2) && outer2 >= inner2) {
                        totalFootage += Math.abs(outer2 - inner2);
                        calculationPossible = true;
                    } else {
                        console.warn(`Invalid sequence pair 2 for itemId ${item.itemId}: Inner=${inner2Str}, Outer=${outer2Str}`);
                        return null; // Invalidate calculation
                    }
                 } else if (inner2Str !== '' || outer2Str !== '') {
                    // Only one sequence entered - invalid
                     console.warn(`Incomplete sequence pair 2 for itemId ${item.itemId}: Inner=${inner2Str}, Outer=${outer2Str}`);
                     return null;
                 }
            }

            // Return calculated footage only if at least one valid pair was processed
            return calculationPossible ? (totalFootage * item.footageFactor) : null;

        } catch (error) {
            console.error(`Error calculating footage for itemId ${item.itemId}:`, error);
            return null;
        }
}

// Called by event handler on sequence input change
async function updateSequences(itemId) {
    if (!itemId) { console.error("updateSequences: itemId missing"); return; }
    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item || !item.isActive || !item.isReel) {
            console.warn(`Item ${itemId} not found, inactive, or not a reel.`);
            return; // Don't update non-existent, inactive, or non-reels
        }

        const itemDiv = document.querySelector(`.inventory-item[data-item-id="${itemId}"]`); // Find the specific location's div
         // If using expanded view, need to find the inputs within that view
         // Placeholder for finding elements in the new expanded view:
         // const expandedCard = document.getElementById(`sku-group-${item.SKU}`); // Assuming an ID for the group
         // const sequenceInputs = findSequenceInputsWithin(expandedCard, itemId); // Helper needed

         // *** TEMPORARY: Assume inputs are findable for now until UI refactor ***
         // This part WILL break with the new UI and needs adjustment
         const sequenceValues = {
            inner1: document.querySelector(`[data-item-id="${itemId}"] input[data-sequence="inner"]`)?.value ?? '',
            outer1: document.querySelector(`[data-item-id="${itemId}"] input[data-sequence="outer"]`)?.value ?? '',
            inner2: document.querySelector(`[data-item-id="${itemId}"] input[data-sequence="inner2"]`)?.value ?? '',
            outer2: document.querySelector(`[data-item-id="${itemId}"] input[data-sequence="outer2"]`)?.value ?? '',
         };
         // *** END OF TEMPORARY INPUT FINDING ***


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
        // Update item model regardless of validity (so UI shows '--' if invalid)
        item.calculatedFootage = calculatedFootage;

        // Update the main count only if calculation is valid
        if (calculatedFootage !== null) {
            const updatedItem = await recordOrUpdateCount(itemId, calculatedFootage, 'sequence_calc', {
                 sequences: sequenceValues // Log the sequences used
            });
            if (!updatedItem) {
                 // recordOrUpdateCount failed, but save sequence changes anyway
                 autoSave().catch(e => console.error("Autosave failed after failed sequence count update:", e));
            }
        } else {
            // Calculation invalid or no sequences entered, just save the sequence changes
            console.log(`Sequences updated for ${itemId}, but calculation invalid or incomplete. Saving sequence data only.`);
             autoSave().catch(e => console.error("Autosave failed after invalid sequence calculation:", e));
             // Maybe flag as uncounted if sequences were entered but invalid? Or leave count as is? Leave as is for now.
        }

        // Re-render needed to show updated sequences, calculated footage, and potentially main count
        applyCurrentFilters(); // Re-filter and render (will need optimization for expanded view)
        updateSummaryCards();

    } catch (error) {
        console.error(`Error updating sequences for itemId ${itemId}:`, error);
        alert(`Failed to update sequences for ${item?.SKU || itemId}. See console.`);
        applyCurrentFilters(); // Re-render to reset UI state if needed
    }
}

// Called by event handler on notes textarea input/change
async function updateItemNotes(itemId, notes) {
    if (!itemId) { console.error("updateItemNotes: itemId missing"); return; }
    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item || !item.isActive) return; // Don't update inactive

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
                 await DB.addTransaction(logEntry);
                 console.log(`Updated notes for ${itemId} (SKU: ${item.SKU}, Loc: ${item.location})`);
              } catch (logError) {
                  console.error(`Failed to log note update for ${itemId}:`, logError);
              }

             // Trigger autosave
             autoSave().catch(e => console.error("Autosave failed after updating notes:", e));
             // No re-render needed just for notes usually, but might be required for expanded view updates
             // applyCurrentFilters(); // Avoid full re-render for now
        }
    } catch (error) {
         console.error(`Error updating notes for itemId ${itemId}:`, error);
         // Maybe provide visual feedback of save failure?
    }
}

// ** NEW: Function to handle adding recount adjustments **
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

    const activeRecountBatchId = currentFilters.recountBatchFilter; // Assuming filter holds the active batch ID
    if (!activeRecountBatchId) {
         alert("No active recount batch selected. Cannot add adjustment.");
         return;
    }

    try {
        const item = await findInventoryItemByItemId(itemId);
        if (!item) {
             alert(`Item with ID ${itemId} not found.`);
             return;
        }

         const timestamp = new Date().toISOString();
         const user = getUserIdentifier();

        // 1. Log the adjustment event itself
        const adjustmentData = {
            itemId: itemId,
            recordedDuringRecountBatchId: activeRecountBatchId,
            adjustmentTransactionId: adjustmentTxId.trim(),
            adjustmentQuantity: adjustmentQty,
            timestamp: timestamp,
            user: user
        };
         await DB.addRecountAdjustment(adjustmentData);
         console.log(`Recount adjustment logged for itemId ${itemId}: TxID=${adjustmentTxId}, Qty=${adjustmentQty}`);


        // 2. Update the item's counted quantity
        const currentCount = item.counted === null ? 0 : item.counted; // Treat null count as 0 for calculation
        const newNetQuantity = currentCount + adjustmentQty;

        // Use recordOrUpdateCount to handle the update, logging, and saving
        const updatedItem = await recordOrUpdateCount(
            itemId,
            newNetQuantity,
            'recount_adjustment', // Source type
            {
                 adjustmentTxId: adjustmentData.adjustmentTransactionId,
                 adjustmentQty: adjustmentData.adjustmentQuantity,
                 previousPhysicalCount: currentCount // Log count before adjustment
            }
        );

        if (updatedItem) {
             // Adjustment added and count updated successfully
             alert(`Adjustment added for ${item.SKU} at ${item.location}.\nNew Count: ${updatedItem.counted}`);
             // Re-render the UI to show updated count and the new adjustment in the list
             applyCurrentFilters(); // TODO: Optimize to only update the specific item group
             updateSummaryCards();
        } else {
             // recordOrUpdateCount might have failed (e.g., item became inactive?)
             // The adjustment *is* logged, but the count wasn't updated.
             console.error(`Adjustment logged for ${itemId}, but failed to update item count.`);
             alert(`Error: Adjustment was logged, but failed to update the item's count. Please check item status or console.`);
             // Re-render might be needed to clear input fields
             applyCurrentFilters(); // TODO: Optimize
        }

    } catch (error) {
        console.error(`Error adding recount adjustment for itemId ${itemId}:`, error);
        alert(`Failed to add recount adjustment. See console for details. ${error.message}`);
    }
}
  
  
  // --- UI Rendering ---
  // Updated the "no items" message. Add reelNumber display.
  function renderInventoryList() {
    const container = document.getElementById('inventoryList');
    if (!container) { console.error("Inventory list container not found."); return; }

    try {
        container.innerHTML = ''; // Clear previous list

        if (currentInventory.length === 0) {
            let message = 'No items marked "To Count" in the current cycle.';
            if (currentFilters.searchTerm) {
                message = `No items marked "To Count" match the current search term ("${currentFilters.searchTerm}")`;
                if (currentFilters.location || currentFilters.status !== 'active') {
                     message += ` and filters (Location: "${currentFilters.location || 'Any'}", Status: "${currentFilters.status}")`;
                }
                message += ".";
                 // TODO: Add suggestion here to search entire inventory?
            } else if (currentFilters.location || currentFilters.status !== 'active') {
                message = `No items marked "To Count" match the current filters (Location: "${currentFilters.location || 'Any'}", Status: "${currentFilters.status}").`;
            } else if (database.inventory.length === 0) {
                message = 'Inventory is empty. Import a CSV to begin.';
            } else if (!database.inventory.some(item => item.toCount)) {
                message = 'No items currently marked "To Count". Start a new count cycle via CSV import.';
            }
            container.innerHTML = `<p>${message}</p>`;
            return;
        }

        const fragment = document.createDocumentFragment();
        currentInventory.forEach(item => {
          try {
              const itemDiv = document.createElement('div');
              itemDiv.className = 'inventory-item';
              itemDiv.dataset.sku = item.SKU;
              itemDiv.dataset.itemId = item.itemId;

              // Status classes... (no change needed here)
              if (!item.isActive) itemDiv.classList.add('is-inactive');
              else if (item.isUncounted) itemDiv.classList.add('is-uncounted');
              else itemDiv.classList.add('is-counted');
              if (item.isReel) itemDiv.classList.add('is-reel');
              if (item.isTwoWayReel) itemDiv.classList.add('is-two-way-reel');

              // Column setup... (no change needed here)
              const columns = { /* ... */ };
               columns.details = document.createElement('div');
              columns.count = document.createElement('div');
              columns.sequences1 = document.createElement('div');
              columns.sequences2 = document.createElement('div'); // New column for 2nd seq pair
              columns.notes = document.createElement('div');    // New column for notes
              columns.actions = document.createElement('div');
              columns.details.className = 'item-details';
              columns.count.className = 'item-count';
              columns.sequences1.className = 'item-sequences seq-pair-1';
              columns.sequences2.className = 'item-sequences seq-pair-2';
              columns.notes.className = 'item-notes';
              columns.actions.className = 'item-actions';


            // --- Populate Details Column (Add Reel Number AND ToCount Indicator) ---
            const reelInfo = item.isReel ? ` (Reel${item.reelNumber ? `: ${item.reelNumber}` : ''}${item.isTwoWayReel ? ', 2-Way' : ''})` : '';
            const toCountIndicator = item.toCount ? `<span class="tocount-indicator" title="Marked for current count cycle">🎯</span>` : ''; // Target emoji or use a class for CSS icon

            columns.details.innerHTML = `
                <div class="item-sku">
                    ${toCountIndicator} ${item.SKU}${reelInfo} ${!item.isActive ? ' [INACTIVE]' : ''}
                </div>
                <div class="item-desc">${item.Description || 'N/A'}</div>
                <div class="item-loc">Loc: ${item.location || 'N/A'}</div>
                <div class="item-id" style="font-size: 0.7em; color: grey;">ID: ${item.itemId}</div>
            `;

              // --- Populate Count Column --- (No changes needed here)
               const countInput = document.createElement('input'); /* ... */
                countInput.type = 'number';
                countInput.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
                countInput.dataset.type = 'count-input';
                countInput.min = "0";
                // Count input is disabled if inactive OR if it's a reel being calculated (sequences take precedence UNLESS initial import?)
                // Let's stick to: disable if inactive or calculated from footage. User flags if count is bad.
                countInput.disabled = !item.isActive || (item.isReel && typeof item.footageFactor === 'number' && item.footageFactor > 0 && item.calculatedFootage !== null);
                if (countInput.disabled && !item.isActive) countInput.title = "Item is inactive";
                else if (countInput.disabled) countInput.title = "Quantity calculated from footage";
                const capturedQtyDisplay = item.capturedQuantity !== null ? `<span class="captured-qty-display">(Expected: ${item.capturedQuantity})</span>` : '';
                columns.count.innerHTML = `<span>Qty:${capturedQtyDisplay}</span>`;
                columns.count.appendChild(countInput);


              // --- Populate Sequences Columns --- (No changes needed here)
               if (item.isReel && typeof item.footageFactor === 'number' && item.footageFactor > 0) { /* ... */ }
               if (item.isReel && typeof item.footageFactor === 'number' && item.footageFactor > 0) {
                 // Pair 1
                 columns.sequences1.innerHTML = `
                      <span>Inner:</span>
                      <input type="number" data-sequence="inner" value="${item.innerSequence ?? ''}" min="0" ${!item.isActive ? 'disabled' : ''}>
                      <span>Outer:</span>
                      <input type="number" data-sequence="outer" value="${item.outerSequence ?? ''}" min="0" ${!item.isActive ? 'disabled' : ''}>
                      <span>=</span>`;
                 const footageDisplay1 = document.createElement('span');
                 footageDisplay1.className = 'calculated-footage-display partial-footage'; // Style differently?
                 columns.sequences1.appendChild(footageDisplay1); // Placeholder for now

                 // Pair 2 (Only if two-way)
                 if (item.isTwoWayReel) {
                      columns.sequences2.innerHTML = `
                          <span>Inner2:</span>
                          <input type="number" data-sequence="inner2" value="${item.innerSequence2 ?? ''}" min="0" ${!item.isActive ? 'disabled' : ''}>
                          <span>Outer2:</span>
                          <input type="number" data-sequence="outer2" value="${item.outerSequence2 ?? ''}" min="0" ${!item.isActive ? 'disabled' : ''}>
                          <span>=</span>`;
                      const footageDisplay2 = document.createElement('span');
                      footageDisplay2.className = 'calculated-footage-display partial-footage';
                      columns.sequences2.appendChild(footageDisplay2); // Placeholder
                 } else {
                      columns.sequences2.style.visibility = 'hidden'; // Hide if not two-way
                 }

                  // Display Total Calculated Footage and Factor
                  const totalFootageDisplay = document.createElement('span');
                  totalFootageDisplay.className = 'calculated-footage-display total-footage';
                  totalFootageDisplay.style.fontWeight = 'bold';
                  totalFootageDisplay.style.marginLeft = '10px';
                  totalFootageDisplay.textContent = (item.calculatedFootage !== null) ? `Total: ${item.calculatedFootage.toFixed(2)} ft` : 'Total: ---';
                  columns.sequences1.appendChild(totalFootageDisplay);
                  columns.sequences1.innerHTML += ` <span style="font-size:0.8em;">(@ ${item.footageFactor})</span>`;
             } else {
                 columns.sequences1.style.visibility = 'hidden';
                 columns.sequences2.style.visibility = 'hidden';
             }


              // --- Populate Notes Column --- (No changes needed here)
               const notesTextarea = document.createElement('textarea'); /* ... */
                notesTextarea.dataset.type = 'notes-input';
                notesTextarea.value = item.notes ?? '';
                notesTextarea.placeholder = 'Add notes...';
                notesTextarea.disabled = !item.isActive;
                columns.notes.appendChild(notesTextarea);

              // --- Populate Actions Column --- (No changes needed here)
               columns.actions.innerHTML = `
                  <button data-action="flag" class="btn-warning" title="Flag item as uncounted" ${!item.isActive ? 'disabled' : ''}>Flag</button>
                  <button data-action="view-history" class="btn-secondary" title="View history for this item">History</button>
              `;

              // Append columns...
              itemDiv.appendChild(columns.details);
              itemDiv.appendChild(columns.count);
              itemDiv.appendChild(columns.sequences1);
              itemDiv.appendChild(columns.sequences2);
              itemDiv.appendChild(columns.notes);
              itemDiv.appendChild(columns.actions);

              fragment.appendChild(itemDiv);
          } catch (itemError) {
              console.error(`Error rendering item ${item?.SKU}:`, itemError);
              const errorDiv = document.createElement('div'); /* ... */
               errorDiv.className = 'inventory-item error-item';
               errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering item ${item?.SKU || '(Unknown SKU)'}</p>`;
               fragment.appendChild(errorDiv);
          }
        });
        container.appendChild(fragment);
        console.log(`Rendered ${currentInventory.length} items marked 'To Count' and matching filters:`, currentFilters);
    } catch (error) {
        console.error("Error rendering inventory list:", error);
        container.innerHTML = `<p class="error-message">Error displaying inventory list. Check console.</p>`;
    }
}

  /*

  function updateSummaryCards() {
      try {
          const totalItems = database.inventory.length;
          const activeItems = database.inventory.filter(item => item.isActive);
          const activeCount = activeItems.length;
          const countedActive = activeItems.filter(item => !item.isUncounted).length;
          const uncountedActive = activeCount - countedActive;
  
          document.getElementById('total-items')?.querySelector('p')?.textContent = totalItems;
          document.getElementById('active-items')?.querySelector('p')?.textContent = activeCount; // New Card
          document.getElementById('counted-items')?.querySelector('p')?.textContent = countedActive;
          document.getElementById('uncounted-items')?.querySelector('p')?.textContent = uncountedActive;
      } catch (error) {
          console.error("Error updating summary cards:", error);
      }
  }
  */

  /*
  Replaced the existing updateSummaryCards function with this refactored version to replace optional chaining (?.).
  This should resolve the "Invalid left-hand side in assignment" error by ensuring the app only attempts to set textContent on elements that actually exist.
  */
    function updateSummaryCards() {
        try {
            const totalItems = database.inventory.length;
            const activeItems = database.inventory.filter(item => item.isActive);
            const activeCount = activeItems.length;
            const countedActive = activeItems.filter(item => !item.isUncounted).length;
            const uncountedActive = activeCount - countedActive;

            // Refactored assignments with checks
            const totalItemsCard = document.getElementById('total-items');
            if (totalItemsCard) {
                const pElement = totalItemsCard.querySelector('p');
                if (pElement) {
                    pElement.textContent = totalItems;
                }
            }

            const activeItemsCard = document.getElementById('active-items');
            if (activeItemsCard) {
                const pElement = activeItemsCard.querySelector('p');
                if (pElement) {
                    pElement.textContent = activeCount; // New Card
                }
            }

            const countedItemsCard = document.getElementById('counted-items');
            if (countedItemsCard) {
                const pElement = countedItemsCard.querySelector('p');
                if (pElement) {
                    pElement.textContent = countedActive;
                }
            }

            const uncountedItemsCard = document.getElementById('uncounted-items');
            if (uncountedItemsCard) {
                const pElement = uncountedItemsCard.querySelector('p');
                if (pElement) {
                    pElement.textContent = uncountedActive;
                }
            }

        } catch (error) {
            console.error("Error updating summary cards:", error);
        }
    }
  
    function renderHistoryView() {
        const container = document.getElementById('historyListContainer');
        if (!container) return;
  
        try {
            container.innerHTML = '';
            if (database.transactionHistory.length === 0) {
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
                            detailsHtml = `Updated count for <strong>${entry.SKU}</strong> from ${entry.details.oldValue ?? (entry.details.wasUncounted ? 'uncounted' : 'N/A')} to <strong>${entry.details.newValue}</strong>.`;
                             if (entry.details.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                            break;
                        case 'flag_uncounted':
                             // Using optional chaining ?. for safety, though N/A fallback exists
                             detailsHtml = `Flagged <strong>${entry.SKU}</strong> as uncounted. (Previous: ${entry.details.previousState?.counted ?? 'N/A'})`;
                            break;
                        case 'update_notes':
                             // Using concise version
                             detailsHtml = `Updated notes for <strong>${entry.SKU}</strong>.`;
                            break;
                        case 'description_change':
                             detailsHtml = `Description change for <strong>${entry.SKU}</strong> from "${entry.details.oldDescription}" to "${entry.details.newDescription}" during import.`;
                             break;
                        case 'status_change': // UPDATED Logic
                             detailsHtml = `Status change for <strong>${entry.SKU}</strong> to <strong>${entry.details.newStatus ? 'Active' : 'Inactive'}</strong>. Reason: ${entry.details.reason || 'Unknown'}`;
                             break;
                         case 'import_csv': // Regular CSV Import
                             detailsHtml = `CSV Import (${entry.details.fileName || 'N/A'}): Added ${entry.details.importedCount}, Updated ${entry.details.updatedCount}, Skipped ${entry.details.skippedCount}.`;
                             if (entry.details.descChanges > 0) detailsHtml += ` (${entry.details.descChanges} description changes logged).`;
                             break;
                        case 'new_count_started_import': // NEW TYPE
                             detailsHtml = `Started new count cycle via CSV Import (${entry.details.fileName || 'N/A'}). Marked ${entry.details.itemsMarkedToCount} items 'To Count'. (Processed ${entry.details.skusImported} SKUs from file: Added ${entry.details.importedCount}, Updated ${entry.details.updatedCount}, Skipped ${entry.details.skippedCount})`;
                             break;
                        case 'inventory_finalized': // MODIFIED details
                             detailsHtml = `<strong>Inventory Finalized.</strong> ${entry.details.deactivatedReelCount} REELS marked inactive. ${entry.details.toCountClearedCount} items had 'To Count' flag cleared.`;
                             break;
                        // REMOVED 'new_count_started' case as it's replaced by 'new_count_started_import'
                        default:
                            detailsHtml = `Unknown action type: ${entry.type} for ${entry.SKU || 'N/A'}`;
                    } // End of the single switch statement
  
                    // Set the innerHTML using the generated detailsHtml
                    div.innerHTML = `
                        <div class="history-meta">${formattedDate} - ${entry.user || 'System'} - ID: ${entry.id || 'N/A'} ${entry.itemId ? `(ItemID: ${entry.itemId})` : ''}</div>
                        <div class="history-details">${detailsHtml}</div>
                    `;
                    fragment.appendChild(div);
  
                 } catch(entryError) { // Catch errors rendering a single entry
                     console.error("Error rendering history entry:", entry, entryError);
                      const errorDiv = document.createElement('div');
                      errorDiv.className = 'history-entry error-entry';
                      errorDiv.innerHTML = `<p class="error-message" style="margin:0;">Error rendering history entry (ID: ${entry?.id || 'N/A'})</p>`;
                      fragment.appendChild(errorDiv);
                 }
                 // NO SECOND SWITCH BLOCK HERE
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
 // *** CHANGE: Accept itemId first, sku second (for title) ***
async function showItemHistory(itemId, sku) {
    // *** CHANGE: Log both parameters ***
    console.log(`[showItemHistory] Function called with ItemID: ${itemId}, SKU: ${sku}`);
    const modal = document.getElementById('itemHistoryModal');
    const title = document.getElementById('itemHistoryModalTitle');
    const body = document.getElementById('itemHistoryModalBody');

    if (!modal || !title || !body) {
        console.error("[showItemHistory] Item history modal elements not found! Cannot display modal.");
        alert("Error: Could not find the history modal elements.");
        return;
    }
    console.log("[showItemHistory] Modal elements found:", { modal, title, body });

    // Find item for description using itemId first
    const item = await findInventoryItemByItemId(itemId); // Use itemId to find the specific item
    if (!item) {
         console.warn(`[showItemHistory] No active inventory item found for ItemID ${itemId}. Using SKU for title.`);
         // Fallback to SKU if item not found (might happen if item deleted but history remains)
         title.textContent = `History for Item ID: ${itemId} (SKU: ${sku || 'Unknown'})`;
    } else {
        // Use description from the specific item found by ID
        title.textContent = `History for Item ID: ${itemId} (SKU: ${item.SKU}, Desc: ${item.Description || 'No Description'})`;
    }
    console.log(`[showItemHistory] Set modal title to: ${title.textContent}`);

    body.innerHTML = '<p>Loading history...</p>';

    try {
        console.log("[showItemHistory] Setting modal display to 'block'.");
        modal.style.display = 'block';
    } catch (displayError) {
         console.error("[showItemHistory] Error setting modal display style:", displayError);
         alert("Error showing the history modal window.");
         return;
    }

    try {
        // *** CHANGE: Query by ItemID using the appropriate DB function ***
        console.log(`[showItemHistory] Querying history from DB for ItemID: '${itemId}'`);
        const itemHistory = await DB.getTransactionHistoryByItemId(itemId); // <-- Use ItemID query
        // *** CHANGE: Log based on ItemID ***
        console.log(`[showItemHistory] History records received from DB for ItemID ${itemId}:`, itemHistory);

        body.innerHTML = '';

        if (!Array.isArray(itemHistory) || itemHistory.length === 0) {
             body.innerHTML = `<p>No specific transaction history found for this item (ID: ${itemId}).</p>`;
             console.log(`[showItemHistory] Displaying 'No history' message for ItemID ${itemId}.`);
        } else {
            const fragment = document.createDocumentFragment();
            itemHistory.forEach(entry => {
                try {
                    const div = document.createElement('div');
                    div.className = 'history-entry';
                    const date = new Date(entry.timestamp);
                    const formattedDate = date.toLocaleString();
                    let detailsHtml = '';
                    // Switch statement remains the same conceptually (render details)
                    switch(entry.type) {
                         case 'update_count':
                            detailsHtml = `Count set to <strong>${entry.details?.newValue ?? 'N/A'}</strong> (was ${entry.details?.oldValue ?? (entry.details?.wasUncounted ? 'uncounted' : 'N/A')}).`;
                            if (entry.details?.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                            break;
                        case 'flag_uncounted':
                            detailsHtml = `Flagged as uncounted.`;
                            break;
                        case 'update_notes':
                             detailsHtml = `Notes updated to: "${entry.details?.newValue ?? ''}"`;
                             break;
                         case 'description_change':
                             detailsHtml = `Description changed to "${entry.details?.newDescription ?? ''}" (was "${entry.details?.oldDescription ?? ''}").`;
                             break;
                        case 'status_change':
                             detailsHtml = `Status changed to <strong>${entry.details?.newStatus ? 'Active' : 'Inactive'}</strong>. Reason: ${entry.details?.reason || 'Unknown'}`;
                             break;
                         // Other cases... (keep them updated as before)
                         case 'import_csv':
                             detailsHtml = `Item data updated during CSV Import (${entry.details?.fileName || 'N/A'}).`;
                             break;
                         case 'new_count_started_import':
                            detailsHtml = `Marked 'To Count' and reset via New Count Cycle Import (${entry.details?.fileName || 'N/A'}).`;
                            break;
                         case 'recount_items_imported':
                            detailsHtml = `Added to Recount Batch '${entry.details?.recountBatchId || 'N/A'}' via CSV Import (${entry.details?.fileName || 'N/A'}) and reset count.`;
                            break;
                        // ... etc ...
                        default:
                            detailsHtml = `Action: ${entry.type}`;
                    }

                    // Display remains the same
                    div.innerHTML = `
                        <div class="history-meta">${formattedDate} - ${entry.user || 'System'} ${entry.itemId ? `(ItemID: ${entry.itemId})` : ''}</div>
                        <div class="history-details">${detailsHtml}</div>
                    `;
                    fragment.appendChild(div);
                } catch (renderEntryError) {
                     console.error(`[showItemHistory] Error rendering single history entry:`, entry, renderEntryError);
                }
            });
            body.appendChild(fragment);
            console.log(`[showItemHistory] Rendered ${itemHistory.length} history entries for ItemID ${itemId}.`);
        }

    } catch (error) {
        // *** CHANGE: Log based on ItemID ***
        console.error(`[showItemHistory] Error loading or rendering history for ItemID ${itemId}:`, error);
        body.innerHTML = `<p class="error-message">Error loading history for this item. Check console.</p>`;
    }
}

  // --- Item Specific History Modal ---
/*
Please replace the existing showItemHistory function with the refined version above. Then, try clicking the "History" button again and observe the console. We should now either see the logs from inside the function, see the modal appear (perhaps with an error message inside if data fetching/rendering fails), or see a new specific error message in the console if a syntax error was indeed the problem or if data is missing during rendering.

    async function showItemHistory(sku) {
      const modal = document.getElementById('itemHistoryModal');
      const title = document.getElementById('itemHistoryModalTitle');
      const body = document.getElementById('itemHistoryModalBody');
      if (!modal || !title || !body) {
          console.error("Item history modal elements not found.");
          return;
      }
  
    // Use findInventoryItemsBySKU (plural) which returns an array
    const items = findInventoryItemsBySKU(sku);

    // Check if any items were found for this SKU
    if (!items || items.length === 0) {
        // It's possible the item exists in history but not in the current inventory view
        // Or the SKU itself is invalid somehow. Provide a generic title.
        console.warn(`No active inventory item found for SKU ${sku} when displaying history. History might still exist.`);
        title.textContent = `History for SKU: ${sku} (${items[0].Description || 'No Description'})`; // Use the description from the first item found

      body.innerHTML = '<p>Loading history...</p>';
      modal.style.display = 'block'; // Show modal immediately
  
    try {
        console.log(`[showItemHistory] Querying history for SKU: '${sku}' (Type: ${typeof sku})`); // <-- ADDED THIS LOG
        const itemHistory = await DB.getTransactionHistoryBySKU(sku); // Use DB function
        console.log(`[showItemHistory] History records received from DB for SKU ${sku}:`, itemHistory); // <-- ADDED THIS LOG

        body.innerHTML = ''; // Clear loading message
  
            if (!itemHistory || itemHistory.length === 0) { // Check if itemHistory is null/undefined as well
                body.innerHTML = '<p>No specific transaction history found for this item.</p>';
                console.log(`[showItemHistory] Displaying 'No history' message for SKU ${sku}.`); // <-- ADD THIS LOG
            return;
            }
  
          const fragment = document.createDocumentFragment();
          // History is already sorted descending by timestamp in DB function
          itemHistory.forEach(entry => {
              const div = document.createElement('div');
              div.className = 'history-entry'; // Reuse class?
              const date = new Date(entry.timestamp);
              const formattedDate = date.toLocaleString();
  
              let detailsHtml = '';
               switch(entry.type) { // Simplified details for item view?
                  case 'update_count':
                      detailsHtml = `Count set to <strong>${entry.details.newValue}</strong> (was ${entry.details.oldValue ?? (entry.details.wasUncounted ? 'uncounted' : 'N/A')}).`;
                      if (entry.details.notes) detailsHtml += ` <i>Note: ${entry.details.notes}</i>`;
                      break;
                  case 'flag_uncounted':
                      detailsHtml = `Flagged as uncounted.`;
                      break;
                  case 'update_notes':
                      detailsHtml = `Notes updated to: "${entry.details.newValue}"`;
                      break;
                  case 'description_change':
                      detailsHtml = `Description changed to "${entry.details.newDescription}" (was "${entry.details.oldDescription}").`;
                      break;
                   case 'status_change':
                       detailsHtml = `Status changed to <strong>${entry.details.newStatus ? 'Active' : 'Inactive'}</strong>.`;
                      break;
                   case 'import_csv': // Less relevant in item view?
                       detailsHtml = `Item data updated during CSV Import (${entry.details.fileName || 'N/A'}).`;
                       break;
                   case 'new_count_started':
                        detailsHtml = `Reset to uncounted at start of new cycle.`;
                       break;
                   // No need for inventory_finalized here as status_change covers it per item
                   default:
                       detailsHtml = `Action: ${entry.type}`;
               }
  
              div.innerHTML = `
                  <div class="history-meta">${formattedDate} - ${entry.user || 'System'}</div>
                  <div class="history-details">${detailsHtml}</div>
              `;
              fragment.appendChild(div);
          });
          body.appendChild(fragment);
  
      } catch (error) {
          console.error(`Error loading history for SKU ${sku}:`, error);
          body.innerHTML = `<p class="error-message">Error loading history for this item.</p>`;
      }
  }
}
*/


function closeItemHistoryModal() {
    const modal = document.getElementById('itemHistoryModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }
  
  // --- CSV Handling ---
/* This function causes a Invalid left-hand side in assignment error often pops up when using newer JavaScript syntax features
(like optional chaining ?. and nullish coalescing ??) that aren't supported by slightly older browser engines, even if they aren't strictly ancient.
The JavaScript engine might get confused parsing complex expressions involving these operators within object literals or conditional assignments.
Refactored to use more traditional, widely compatible checks. (ternary operators and explicit null/undefined comparisons) instead of ?? and ?. .

  async function showImportDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, text/csv';
    input.style.display = 'none';
  
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      console.log(`Attempting to import CSV: ${file.name}`);
  
      try {
        const fileContent = await readFile(file).catch(readError => {
            throw new Error(`Failed to read file: ${readError.message}`);
        });
  
        const result = Papa.parse(fileContent, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false, // Keep as strings initially
          transformHeader: header => header.trim()
        });
  
        if (result.errors.length > 0) {
          console.error("CSV Parsing Errors:", result.errors);
          throw new Error(`CSV parsing error(s): ${result.errors[0].message}. Please check file format.`);
        }
        const parsedData = result.data;
        if (!parsedData || parsedData.length === 0) {
          throw new Error("CSV file is empty or contains no data rows.");
        }
  
        // --- Data Processing ---
        try {
              let importedCount = 0, updatedCount = 0, skippedCount = 0, descChanges = 0;
              const processedSkus = new Set(); // Track SKUs processed in *this* file
  
              // --- Header Detection (Case-insensitive, flexible) ---
              const headers = result.meta.fields;
              const findHeader = (possibleNames) => {
                  for (const name of possibleNames) {
                      const found = headers.find(h => h && h.toLowerCase() === name.toLowerCase());
                      if (found) return found;
                  }
                  return null;
              };
  
              // Find all relevant headers
              const skuHeader = findHeader(['sku', 'item', 'partnumber', 'part number']);
              const descHeader = findHeader(['description', 'desc']);
              const locHeader = findHeader(['location', 'loc']);
              const countHeader = findHeader(['counted', 'quantity', 'qty', 'count']); // Current count
              const capturedQtyHeader = findHeader(['capturedquantity', 'expectedquantity', 'expected qty', 'captured qty']); // Historical/Expected
              const notesHeader = findHeader(['notes', 'note', 'comments']);
              const isActiveHeader = findHeader(['isactive', 'active']);
              const isReelHeader = findHeader(['isreel', 'reel']);
              const isTwoWayReelHeader = findHeader(['istwowayreel', 'twowayreel', 'two way reel']);
              const footageFactorHeader = findHeader(['footagefactor', 'factor', 'ft factor']);
              const innerSeqHeader = findHeader(['innersequence', 'inner seq', 'inner']);
              const outerSeqHeader = findHeader(['outersequence', 'outer seq', 'outer']);
              const innerSeq2Header = findHeader(['innersequence2', 'inner seq 2', 'inner2']);
              const outerSeq2Header = findHeader(['outersequence2', 'outer seq 2', 'outer2']);
               // const itemIdHeader = findHeader(['itemid', 'uniqueid']); // Optional: Import existing ID? Risky if not managed well. Better to generate.
  
              if (!skuHeader) {
                   throw new Error("Required header 'SKU' (or similar) not found in CSV.");
              }
               console.log("Detected Headers:", { skuHeader, descHeader, locHeader, countHeader, capturedQtyHeader, notesHeader, isActiveHeader, isReelHeader, isTwoWayReelHeader, footageFactorHeader, innerSeqHeader, outerSeqHeader, innerSeq2Header, outerSeq2Header });
  
  
              // --- Process Rows ---
              parsedData.forEach((row, index) => {
                  const sku = String(row[skuHeader] || '').trim();
                  if (!sku) {
                      console.warn(`Skipping row ${index + 1}: Missing SKU.`);
                      skippedCount++;
                      return;
                  }
  
                  if (processedSkus.has(sku)) {
                      console.warn(`Skipping row ${index + 1}: Duplicate SKU '${sku}' found in this CSV file.`);
                      skippedCount++;
                      return;
                  }
                  processedSkus.add(sku);
  
                  const existingItem = findInventoryItem(sku);
                  const incomingDesc = String(row[descHeader] || (existingItem?.Description) || 'No Description').trim();
  
                  // --- Handle Description Change (Requirement 5.1.1/5.1.2) ---
                  if (existingItem && existingItem.Description !== incomingDesc) {
                       console.log(`Description change detected for SKU ${sku}: "${existingItem.Description}" -> "${incomingDesc}"`);
                       logTransaction({
                           type: 'description_change',
                           SKU: sku,
                           itemId: existingItem.itemId,
                           details: {
                               oldDescription: existingItem.Description,
                               newDescription: incomingDesc
                           }
                       });
                       descChanges++;
                       // Update description in the existing item object directly
                       existingItem.Description = incomingDesc;
                  }
  
                  // --- Prepare Item Data Object ---
                  // Start with defaults or existing data, then overwrite with CSV values if present
                  const newItemData = {
                      SKU: sku,
                      itemId: existingItem?.itemId ?? DB.generateSimpleId(), // Use existing ID or generate new
                      Description: incomingDesc, // Already handled above
                      location: String(row[locHeader] ?? (existingItem?.location) ?? 'No Location').trim(),
                      notes: String(row[notesHeader] ?? (existingItem?.notes) ?? '').trim(),
                      // Status - Default to true unless explicitly set to 'false', '0', 'no' in CSV
                      isActive: isActiveHeader && ['false', '0', 'no'].includes(String(row[isActiveHeader] || '').toLowerCase()) ? false : (existingItem?.isActive ?? true),
                      // Reel flags - Default to false unless explicitly 'true', '1', 'yes'
                      isReel: isReelHeader && ['true', '1', 'yes'].includes(String(row[isReelHeader] || '').toLowerCase()) ? true : (existingItem?.isReel ?? false),
                      isTwoWayReel: false, // Calculated below based on isReel
                      footageFactor: (footageFactorHeader && row[footageFactorHeader] !== undefined && row[footageFactorHeader] !== '') ? (Number(row[footageFactorHeader]) || null) : (existingItem?.footageFactor ?? null),
                      // Sequences
                      innerSequence: String(row[innerSeqHeader] ?? (existingItem?.innerSequence) ?? '').trim(),
                      outerSequence: String(row[outerSeqHeader] ?? (existingItem?.outerSequence) ?? '').trim(),
                      innerSequence2: String(row[innerSeq2Header] ?? (existingItem?.innerSequence2) ?? '').trim(),
                      outerSequence2: String(row[outerSeq2Header] ?? (existingItem?.outerSequence2) ?? '').trim(),
                      // Captured Quantity
                      capturedQuantity: (capturedQtyHeader && row[capturedQtyHeader] !== undefined && row[capturedQtyHeader] !== '') ? (Number(row[capturedQtyHeader]) || null) : (existingItem?.capturedQuantity ?? null),
                      // Current Count State - Start assuming uncounted, override below
                      counted: existingItem?.counted ?? null,
                      isUncounted: existingItem?.isUncounted ?? true,
                      calculatedFootage: existingItem?.calculatedFootage ?? null,
                      lastCountTimestamp: existingItem?.lastCountTimestamp ?? null // Preserve last known timestamp
                  };
  
                   // Validate/Clean up parsed numbers
                   if (isNaN(newItemData.footageFactor) || newItemData.footageFactor <= 0) newItemData.footageFactor = null;
                   if (isNaN(newItemData.capturedQuantity) || newItemData.capturedQuantity < 0) newItemData.capturedQuantity = null;
  
  
                  // Apply Reel Logic
                  newItemData.isTwoWayReel = newItemData.isReel && (isTwoWayReelHeader && ['true', '1', 'yes'].includes(String(row[isTwoWayReelHeader] || '').toLowerCase()) ? true : (existingItem?.isTwoWayReel ?? false));
                  if (!newItemData.isReel) { // Ensure non-reels don't have reel flags/data
                      newItemData.isTwoWayReel = false;
                      newItemData.footageFactor = null;
                      newItemData.innerSequence = ''; newItemData.outerSequence = '';
                      newItemData.innerSequence2 = ''; newItemData.outerSequence2 = '';
                      newItemData.calculatedFootage = null;
                  }
  
  
                  // --- Determine Current Count based on CSV ---
                  let countSource = "preserved"; // or "csv_count", "csv_sequences"
  
                  // 1. Check for Sequences (if it's a reel with factor)
                  if (newItemData.isReel && newItemData.footageFactor) {
                       const hasSequences1 = newItemData.innerSequence !== '' || newItemData.outerSequence !== '';
                       const hasSequences2 = newItemData.isTwoWayReel && (newItemData.innerSequence2 !== '' || newItemData.outerSequence2 !== '');
  
                       if (hasSequences1 || hasSequences2) { // Only calculate if sequences are provided in CSV
                           const calculated = calculateFootage(newItemData, {
                               inner1: newItemData.innerSequence, outer1: newItemData.outerSequence,
                               inner2: newItemData.innerSequence2, outer2: newItemData.outerSequence2
                           });
  
                           if (calculated !== null) {
                               newItemData.counted = calculated;
                               newItemData.calculatedFootage = calculated;
                               newItemData.isUncounted = false;
                               newItemData.lastCountTimestamp = new Date().toISOString();
                               countSource = "csv_sequences";
                           } else {
                               console.warn(`Invalid sequences in CSV for reel ${sku}. Preserving existing count state.`);
                               // Keep existing count state (already set from existingItem or default)
                               newItemData.calculatedFootage = null; // Ensure calculated is null if sequences invalid
                               countSource = "preserved_invalid_sequences";
                           }
                       }
                       // If no sequences provided in CSV for a reel, preserve existing count state.
                  }
  
                  // 2. Check for explicit Count column (Only if sequences weren't used)
                  if (countSource === "preserved" || countSource === "preserved_invalid_sequences") {
                       if (countHeader && row[countHeader] !== undefined && row[countHeader] !== '') {
                           const count = Number(String(row[countHeader]).trim());
                           if (!isNaN(count) && count >= 0) {
                               newItemData.counted = count;
                               newItemData.isUncounted = false;
                               newItemData.lastCountTimestamp = new Date().toISOString();
                               // Clear reel-specific calculated data if count is manually provided
                               newItemData.calculatedFootage = null;
                               countSource = "csv_count";
                           } else {
                               console.warn(`Skipping invalid count in CSV for SKU ${sku}: ${row[countHeader]}. Preserving existing count state.`);
                           }
                       }
                  }
                  // If neither sequences nor count provided, the initial preserved state (or default null/true) remains.
  
  
                  // --- Update or Add Item ---
                  if (existingItem) {
                      // Merge newItemData into existingItem
                      Object.assign(existingItem, newItemData);
                      updatedCount++;
                  } else {
                      // Add as a completely new item
                      database.inventory.push(newItemData);
                      importedCount++;
                  }
              }); // End forEach row
  
              // Log overall import transaction
              if (importedCount > 0 || updatedCount > 0 || skippedCount > 0) {
                   logTransaction({
                      type: 'import_csv',
                      details: {
                          fileName: file.name,
                          importedCount: importedCount,
                          updatedCount: updatedCount,
                          skippedCount: skippedCount,
                          descChanges: descChanges // Log description changes count
                      }
                   });
              }
  
              // Save, refresh UI
              try {
                   await autoSave();
                   applyCurrentFilters(); // Re-apply filters and render
                   updateSummaryCards();
              } catch (uiSaveError) {
                   console.error("Error saving or updating UI after import:", uiSaveError);
                   alert("Import partially successful, but failed to save or update the display. Please refresh. Check console for details.");
              }
  
              // --- User Feedback ---
              let message = `Import complete!\nAdded: ${importedCount}\nUpdated: ${updatedCount}\nSkipped: ${skippedCount}`;
              if (descChanges > 0) message += `\n(${descChanges} description changes detected & logged.)`;
              message += "\n(Check console for details)";
  
              if (importedCount > 0 || updatedCount > 0 || descChanges > 0) {
                   alert(message);
               } else if (skippedCount > 0) {
                    alert(`Import finished. No items were added or updated. Skipped: ${skippedCount}\n(Check console for details)`);
               } else {
                   alert("Import finished. No changes detected in the CSV compared to current inventory.");
               }
  
        } catch (processingError) {
             console.error("Error processing imported CSV data:", processingError);
             alert(`Error processing CSV data: ${processingError.message}`);
             applyCurrentFilters(); // Re-render current state
        }
  
      } catch (error) {
        console.error('Error processing CSV:', error);
        alert('Error importing CSV: ' + error.message);
      } finally {
          if (input.parentNode) { input.parentNode.removeChild(input); }
      }
    };
  
    document.body.appendChild(input);
    input.click();
  }
*/
/* This MODIFIED showImportDialog() directly addresses the syntax likely causing the "Invalid left-hand side" error in browsers that don't fully support ES2020 features.
This function was subsequently modified to handle the isNewCountCycle context, updated duplicate logic, and sequence handling. The "Invalid left-hand side" error may reappear. 

async function showImportDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, text/csv';
    input.style.display = 'none';
  
    input.onchange = async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      console.log(`Attempting to import CSV: ${file.name}`);
  
      try {
        const fileContent = await readFile(file).catch(readError => {
            throw new Error(`Failed to read file: ${readError.message}`);
        });
  
        const result = Papa.parse(fileContent, {
          header: true,
          skipEmptyLines: true,
          dynamicTyping: false, // Keep as strings initially
          transformHeader: header => header.trim()
        });
  
        if (result.errors.length > 0) {
          console.error("CSV Parsing Errors:", result.errors);
          throw new Error(`CSV parsing error(s): ${result.errors[0].message}. Please check file format.`);
        }
        const parsedData = result.data;
        if (!parsedData || parsedData.length === 0) {
          throw new Error("CSV file is empty or contains no data rows.");
        }
  
        // --- Data Processing ---
        try {
              let importedCount = 0, updatedCount = 0, skippedCount = 0, descChanges = 0;
              const processedSkus = new Set(); // Track SKUs processed in *this* file
  
              // --- Header Detection (Case-insensitive, flexible) ---
              const headers = result.meta.fields;
              const findHeader = (possibleNames) => {
                  for (const name of possibleNames) {
                      const found = headers.find(h => h && h.toLowerCase() === name.toLowerCase());
                      if (found) return found;
                  }
                  return null;
              };
  
              // Find all relevant headers
              const skuHeader = findHeader(['sku', 'item', 'partnumber', 'part number']);
              const descHeader = findHeader(['description', 'desc']);
              const locHeader = findHeader(['location', 'loc']);
              const countHeader = findHeader(['counted', 'quantity', 'qty', 'count']); // Current count
              const capturedQtyHeader = findHeader(['capturedquantity', 'expectedquantity', 'expected qty', 'captured qty']); // Historical/Expected
              const notesHeader = findHeader(['notes', 'note', 'comments']);
              const isActiveHeader = findHeader(['isactive', 'active']);
              const isReelHeader = findHeader(['isreel', 'reel']);
              const isTwoWayReelHeader = findHeader(['istwowayreel', 'twowayreel', 'two way reel']);
              const footageFactorHeader = findHeader(['footagefactor', 'factor', 'ft factor']);
              const innerSeqHeader = findHeader(['innersequence', 'inner seq', 'inner']);
              const outerSeqHeader = findHeader(['outersequence', 'outer seq', 'outer']);
              const innerSeq2Header = findHeader(['innersequence2', 'inner seq 2', 'inner2']);
              const outerSeq2Header = findHeader(['outersequence2', 'outer seq 2', 'outer2']);
  
              if (!skuHeader) {
                   throw new Error("Required header 'SKU' (or similar) not found in CSV.");
              }
               console.log("Detected Headers:", { skuHeader, descHeader, locHeader, countHeader, capturedQtyHeader, notesHeader, isActiveHeader, isReelHeader, isTwoWayReelHeader, footageFactorHeader, innerSeqHeader, outerSeqHeader, innerSeq2Header, outerSeq2Header });
  
  
              // --- Process Rows ---
              parsedData.forEach((row, index) => {
                  const sku = String(row[skuHeader] || '').trim();
                  if (!sku) {
                      console.warn(`Skipping row ${index + 1}: Missing SKU.`);
                      skippedCount++;
                      return;
                  }
  
                  if (processedSkus.has(sku)) {
                      console.warn(`Skipping row ${index + 1}: Duplicate SKU '${sku}' found in this CSV file.`);
                      skippedCount++;
                      return;
                  }
                  processedSkus.add(sku);
  
                  const existingItem = findInventoryItem(sku);
  
                  // Helper function to check for null/undefined
                  const isSet = (value) => value !== null && value !== undefined;
  
                  // Get incoming description first
                  let incomingDescRaw = row[descHeader];
                  let incomingDesc = String((isSet(incomingDescRaw) ? incomingDescRaw : (existingItem && isSet(existingItem.Description) ? existingItem.Description : 'No Description'))).trim();
  
  
                  // --- Handle Description Change (Requirement 5.1.1/5.1.2) ---
                  if (existingItem && existingItem.Description !== incomingDesc) {
                       console.log(`Description change detected for SKU ${sku}: "${existingItem.Description}" -> "${incomingDesc}"`);
                       logTransaction({
                           type: 'description_change',
                           SKU: sku,
                           itemId: existingItem.itemId, // existingItem guaranteed here
                           details: {
                               oldDescription: existingItem.Description,
                               newDescription: incomingDesc
                           }
                       });
                       descChanges++;
                       // Update description in the existing item object directly BEFORE creating newItemData
                       existingItem.Description = incomingDesc;
                  }
  
                  // --- Prepare Item Data Object (Browser Compatibility Version) ---
                  const newItemData = {}; // Start with empty object
  
                  newItemData.SKU = sku;
                  newItemData.itemId = (existingItem && isSet(existingItem.itemId)) ? existingItem.itemId : DB.generateSimpleId();
                  newItemData.Description = incomingDesc; // Use potentially updated description
  
                  // location
                  let locValue = row[locHeader];
                  newItemData.location = String(isSet(locValue) ? locValue : (existingItem && isSet(existingItem.location)) ? existingItem.location : 'No Location').trim();
  
                  // notes
                  let notesValue = row[notesHeader];
                  newItemData.notes = String(isSet(notesValue) ? notesValue : (existingItem && isSet(existingItem.notes)) ? existingItem.notes : '').trim();
  
                  // isActive
                  let defaultIsActive = (existingItem && isSet(existingItem.isActive)) ? existingItem.isActive : true;
                  newItemData.isActive = (isActiveHeader && isSet(row[isActiveHeader]) && ['false', '0', 'no'].includes(String(row[isActiveHeader]).toLowerCase()))
                                         ? false
                                         : defaultIsActive;
  
                  // isReel
                  let defaultIsReel = (existingItem && isSet(existingItem.isReel)) ? existingItem.isReel : false;
                  newItemData.isReel = (isReelHeader && isSet(row[isReelHeader]) && ['true', '1', 'yes'].includes(String(row[isReelHeader]).toLowerCase()))
                                       ? true
                                       : defaultIsReel;
  
                  // isTwoWayReel (set after main object creation)
                  newItemData.isTwoWayReel = false;
  
                  // footageFactor
                  let defaultFootageFactor = (existingItem && isSet(existingItem.footageFactor)) ? existingItem.footageFactor : null;
                  newItemData.footageFactor = (footageFactorHeader && isSet(row[footageFactorHeader]) && row[footageFactorHeader] !== '')
                                              ? (Number(row[footageFactorHeader]) || null) // Use || null to handle NaN from Number()
                                              : defaultFootageFactor;
  
                  // Sequences
                  let innerSeqValue = row[innerSeqHeader];
                  newItemData.innerSequence = String(isSet(innerSeqValue) ? innerSeqValue : (existingItem && isSet(existingItem.innerSequence)) ? existingItem.innerSequence : '').trim();
  
                  let outerSeqValue = row[outerSeqHeader];
                  newItemData.outerSequence = String(isSet(outerSeqValue) ? outerSeqValue : (existingItem && isSet(existingItem.outerSequence)) ? existingItem.outerSequence : '').trim();
  
                  let innerSeq2Value = row[innerSeq2Header];
                  newItemData.innerSequence2 = String(isSet(innerSeq2Value) ? innerSeq2Value : (existingItem && isSet(existingItem.innerSequence2)) ? existingItem.innerSequence2 : '').trim();
  
                  let outerSeq2Value = row[outerSeq2Header];
                  newItemData.outerSequence2 = String(isSet(outerSeq2Value) ? outerSeq2Value : (existingItem && isSet(existingItem.outerSequence2)) ? existingItem.outerSequence2 : '').trim();
  
                  // capturedQuantity
                  let defaultCapturedQty = (existingItem && isSet(existingItem.capturedQuantity)) ? existingItem.capturedQuantity : null;
                  newItemData.capturedQuantity = (capturedQtyHeader && isSet(row[capturedQtyHeader]) && row[capturedQtyHeader] !== '')
                                                 ? (Number(row[capturedQtyHeader]) || null)
                                                 : defaultCapturedQty;
  
                  // counted
                  newItemData.counted = (existingItem && isSet(existingItem.counted)) ? existingItem.counted : null;
  
                  // isUncounted
                  newItemData.isUncounted = (existingItem && isSet(existingItem.isUncounted)) ? existingItem.isUncounted : true;
  
                  // calculatedFootage
                  newItemData.calculatedFootage = (existingItem && isSet(existingItem.calculatedFootage)) ? existingItem.calculatedFootage : null;
  
                  // lastCountTimestamp
                  newItemData.lastCountTimestamp = (existingItem && isSet(existingItem.lastCountTimestamp)) ? existingItem.lastCountTimestamp : null;
                  // --- End of newItemData Population ---
  
  
                  // --- Validate/Clean up parsed numbers --- (This is likely where line 852 was in the *previous* output)
                  if (isNaN(newItemData.footageFactor) || newItemData.footageFactor <= 0) newItemData.footageFactor = null;
                  if (isNaN(newItemData.capturedQuantity) || newItemData.capturedQuantity < 0) newItemData.capturedQuantity = null;
  
  
                  // --- Apply Reel Logic ---
                  let defaultIsTwoWayReel = (existingItem && isSet(existingItem.isTwoWayReel)) ? existingItem.isTwoWayReel : false;
                  newItemData.isTwoWayReel = newItemData.isReel && (isTwoWayReelHeader && isSet(row[isTwoWayReelHeader]) && ['true', '1', 'yes'].includes(String(row[isTwoWayReelHeader]).toLowerCase())
                                                ? true
                                                : defaultIsTwoWayReel);
                  if (!newItemData.isReel) { // Ensure non-reels don't have reel flags/data
                      newItemData.isTwoWayReel = false;
                      newItemData.footageFactor = null;
                      newItemData.innerSequence = ''; newItemData.outerSequence = '';
                      newItemData.innerSequence2 = ''; newItemData.outerSequence2 = '';
                      newItemData.calculatedFootage = null;
                  }
  
  
                  // --- Determine Current Count based on CSV ---
                  let countSource = "preserved";
  
                  if (newItemData.isReel && newItemData.footageFactor) {
                       const hasSequences1 = newItemData.innerSequence !== '' || newItemData.outerSequence !== '';
                       const hasSequences2 = newItemData.isTwoWayReel && (newItemData.innerSequence2 !== '' || newItemData.outerSequence2 !== '');
  
                       if (hasSequences1 || hasSequences2) {
                           const calculated = calculateFootage(newItemData, {
                               inner1: newItemData.innerSequence, outer1: newItemData.outerSequence,
                               inner2: newItemData.innerSequence2, outer2: newItemData.outerSequence2
                           });
  
                           if (calculated !== null) {
                               newItemData.counted = calculated;
                               newItemData.calculatedFootage = calculated;
                               newItemData.isUncounted = false;
                               newItemData.lastCountTimestamp = new Date().toISOString();
                               countSource = "csv_sequences";
                           } else {
                               console.warn(`Invalid sequences in CSV for reel ${sku}. Preserving existing count state.`);
                               newItemData.calculatedFootage = null;
                               countSource = "preserved_invalid_sequences";
                           }
                       }
                  }
  
                  if (countSource === "preserved" || countSource === "preserved_invalid_sequences") {
                       if (countHeader && isSet(row[countHeader]) && row[countHeader] !== '') {
                           const count = Number(String(row[countHeader]).trim());
                           if (!isNaN(count) && count >= 0) {
                               newItemData.counted = count;
                               newItemData.isUncounted = false;
                               newItemData.lastCountTimestamp = new Date().toISOString();
                               newItemData.calculatedFootage = null;
                               countSource = "csv_count";
                           } else {
                               console.warn(`Skipping invalid count in CSV for SKU ${sku}: ${row[countHeader]}. Preserving existing count state.`);
                           }
                       }
                  }
  
  
                  // --- Update or Add Item ---
                  if (existingItem) {
                      // Merge newItemData into existingItem
                      Object.assign(existingItem, newItemData);
                      updatedCount++;
                  } else {
                      // Add as a completely new item
                      database.inventory.push(newItemData);
                      importedCount++;
                  }
              }); // End forEach row
  
              // Log overall import transaction
              if (importedCount > 0 || updatedCount > 0 || skippedCount > 0) {
                   logTransaction({
                      type: 'import_csv',
                      details: {
                          fileName: file.name,
                          importedCount: importedCount,
                          updatedCount: updatedCount,
                          skippedCount: skippedCount,
                          descChanges: descChanges
                      }
                   });
              }
  
              // Save, refresh UI
              try {
                   await autoSave();
                   applyCurrentFilters();
                   updateSummaryCards();
              } catch (uiSaveError) {
                   console.error("Error saving or updating UI after import:", uiSaveError);
                   alert("Import partially successful, but failed to save or update the display. Please refresh. Check console for details.");
              }
  
              // --- User Feedback ---
              let message = `Import complete!\nAdded: ${importedCount}\nUpdated: ${updatedCount}\nSkipped: ${skippedCount}`;
              if (descChanges > 0) message += `\n(${descChanges} description changes detected & logged.)`;
              message += "\n(Check console for details)";
  
              if (importedCount > 0 || updatedCount > 0 || descChanges > 0) {
                   alert(message);
               } else if (skippedCount > 0) {
                    alert(`Import finished. No items were added or updated. Skipped: ${skippedCount}\n(Check console for details)`);
               } else {
                   alert("Import finished. No changes detected in the CSV compared to current inventory.");
               }
  
        } catch (processingError) {
             console.error("Error processing imported CSV data:", processingError);
             alert(`Error processing CSV data: ${processingError.message}`);
             applyCurrentFilters(); // Re-render current state
        }
  
      } catch (error) {
        console.error('Error processing CSV:', error);
        alert('Error importing CSV: ' + error.message);
      } finally {
          if (input.parentNode) { input.parentNode.removeChild(input); }
      }
    };
  
    document.body.appendChild(input);
    input.click();
  }
*/
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
            // ... (recount batch prompt logic remains the same) ...
             // Simple prompt for now, can be enhanced with a modal
            const batchIdentifier = prompt(`Enter a unique identifier for this RECOUNT batch (e.g., YYMMDD.R<n>, like ${new Date().toISOString().slice(2,10).replace(/-/g,'')}.R1):`);
            const dateInput = prompt(`Enter the Cut-off Date for this recount batch (YYYY-MM-DD):`);

             if (!batchIdentifier || !dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
                 alert("Recount cancelled: Valid Batch Identifier and Cut-off Date (YYYY-MM-DD) are required.");
                 if (input.parentNode) { input.parentNode.removeChild(input); }
                 return;
             }
             recountBatchId = batchIdentifier.trim();
             cutOffDate = dateInput; // Store the date

             // Check if batch ID already exists (optional but good)
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
                    status: 'open', // Mark as open
                    createdAt: new Date().toISOString(),
                    createdBy: getUserIdentifier() // Track who created it
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
                dynamicTyping: false,
                transformHeader: header => { // Ensure this exact transformHeader is used
                    // Remove BOM character if present at the start, then trim
                    if (header.charCodeAt(0) === 0xFEFF) {
                        // console.log(`BOM detected in header: "${header}"`); // DEBUG LOG
                        header = header.substring(1);
                    }
                    return header.trim();
                }
            });

            // --- *** NEW DEBUG LOG *** ---
            console.log("PapaParse Meta:", result.meta);
            console.log("PapaParse Headers (result.meta.fields):", result.meta.fields); // Log headers *after* transform

            if (result.errors.length > 0) {
                console.error("CSV Parsing Errors:", result.errors);
                throw new Error(`CSV parsing error(s): ${result.errors[0].message}. Check file format.`);
            }
            const parsedData = result.data;
            if (!parsedData || parsedData.length === 0) {
                throw new Error("CSV file is empty or contains no data rows.");
            }

            // --- Data Processing ---
            try {
                let processedItemsMap = new Map();
                const skusInThisImport = new Set();
                let skippedCount = 0;
                let descChanges = 0;
                let itemsMarkedToCount = 0;
                let itemsAddedToRecount = 0;


                // --- Header Detection ---
                const headers = result.meta.fields; // Use the headers from PapaParse result

                // --- *** MODIFIED findHeader with more logging *** ---
                const findHeader = (possibleNames) => {
                    console.log(`Searching for headers: [${possibleNames.join(', ')}]`); // DEBUG LOG
                    for (const name of possibleNames) {
                        console.log(` Checking against possible name: "${name}"`); // DEBUG LOG
                        // Find the first header from the parsed list that matches (case-insensitive)
                        const found = headers.find(h => {
                            const transformedH = h && typeof h === 'string' ? h.trim().toLowerCase() : null;
                            const targetName = name.toLowerCase();
                            const comparison = transformedH === targetName;
                            // console.log(`  Comparing parsed header "${h}" (transformed: "${transformedH}") with target "${targetName}": ${comparison}`); // DEBUG LOG (Verbose)
                            return comparison;
                        });

                        if (found) {
                            console.log(`  Found match for "${name}": "${found}" (original parsed header)`); // DEBUG LOG
                            return found; // Return the original (but transformed) header name from the list
                        }
                    }
                    console.warn(` Header not found for any of: [${possibleNames.join(', ')}]`); // DEBUG LOG
                    return null;
                };
                // --- *** End of modified findHeader *** ---

                console.log("Attempting to find required headers..."); // DEBUG LOG
                const skuHeader = findHeader(['sku', 'item', 'partnumber', 'part number']);
                const descHeader = findHeader(['description', 'desc']);
                const locHeader = findHeader(['location', 'loc']);
                const reelNumHeader = findHeader(['reelnumber', 'reel num', 'reel #', 'reel no', 'reel no.', 'reel number']);
                // ... (find other headers as before) ...
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


                if (!skuHeader) {
                    console.error("Failed to find SKU header in parsed headers:", headers); // DEBUG LOG
                    throw new Error("Required header 'SKU' (or similar like 'item', 'partnumber') not found in CSV.");
                }
                if (!locHeader && !reelNumHeader) throw new Error("Required header 'location' or 'reelNumber' not found.");
                console.log("Required headers found. Proceeding with row processing..."); // DEBUG LOG


                // --- Process Rows (logic inside remains the same as previous version) ---
                parsedData.forEach((row, index) => {
                    // ... (validation, duplicate check, data prep, context handling) ...
                    // --- Basic Validation and Duplicate Check ---
                    const rowNum = index + 2;
                    const sku = String(row[skuHeader] || '').trim(); // Use found skuHeader
                    const location = String(row[locHeader] || '').trim(); // Use found locHeader (might be null)
                    const reelNumber = String(row[reelNumHeader] || '').trim(); // Use found reelNumHeader (might be null)

                    if (!sku) { console.warn(`Skipping row ${rowNum}: Missing SKU.`); skippedCount++; return; }
                     // Location OR Reel Number is required
                    if (!location && !reelNumber) { console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Missing Location or Reel Number.`); skippedCount++; return; }

                    let isLikelyReelFromCSV = (isReelHeader && ['true', '1', 'yes'].includes(String(row[isReelHeader] || '').toLowerCase())) || !!reelNumber;
                    const uniqueKey = isLikelyReelFromCSV ? `reel-${reelNumber}` : `sku-${sku}|loc-${location.toLowerCase()}`;
                     if (skusInThisImport.has(uniqueKey)) { console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Duplicate ${isLikelyReelFromCSV ? `Reel# ${reelNumber}` : `SKU/Loc ${location}`} in file.`); skippedCount++; return; }
                    if (isLikelyReelFromCSV && !reelNumber) { console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Reel indicated but Reel Number missing.`); skippedCount++; return; }
                    skusInThisImport.add(uniqueKey);

                    // Find existing item
                     const existingItemFromDB = findExistingItemRecord(sku, location, reelNumber);
                     const itemId = existingItemFromDB ? existingItemFromDB.itemId : DB.generateSimpleId();
                     let currentItemData = processedItemsMap.get(itemId) || {};
                     let newItemDataForRow = { ...currentItemData }; // Clone

                     // --- Merge Data ---
                     newItemDataForRow.itemId = itemId;
                     newItemDataForRow.SKU = sku;
                     newItemDataForRow.location = location;
                     newItemDataForRow.reelNumber = reelNumber;

                     // Helpers (assuming these are defined elsewhere correctly)
                     const isSet = (value) => value !== null && value !== undefined;
                     const getValue = (header, prop, def) => String(isSet(row[header]) ? row[header] : (currentItemData[prop] ?? def)).trim();
                     const getBooleanValue = (header, prop, def, trueStrings = ['true', '1', 'yes'], falseStrings = ['false', '0', 'no']) => isSet(row[header]) ? trueStrings.includes(String(row[header]).toLowerCase()) : (currentItemData[prop] ?? def);
                     const getNumericValue = (header, prop, def, allowNeg = false) => { let v = row[header]; return isSet(v) && v !== '' ? (Number(v) || (allowNeg ? 0 : null)) : (currentItemData[prop] ?? def); };

                      // Description + Change Logging
                      let incomingDescRaw = row[descHeader];
                      let existingDesc = currentItemData.Description || 'No Description';
                      let incomingDesc = String((isSet(incomingDescRaw) ? incomingDescRaw : existingDesc)).trim();
                      if (currentItemData.itemId && existingDesc !== incomingDesc) { descChanges++; /* logTransaction(...) */ }
                      newItemDataForRow.Description = incomingDesc;

                     // Other fields
                     newItemDataForRow.notes = getValue(notesHeader, 'notes', '');
                     newItemDataForRow.isActive = getBooleanValue(isActiveHeader, 'isActive', true);
                     newItemDataForRow.isReel = isLikelyReelFromCSV || (currentItemData.isReel ?? false);
                     newItemDataForRow.footageFactor = getNumericValue(footageFactorHeader, 'footageFactor', null);
                     newItemDataForRow.innerSequence = getValue(innerSeqHeader, 'innerSequence', '');
                     newItemDataForRow.outerSequence = getValue(outerSeqHeader, 'outerSequence', '');
                     newItemDataForRow.innerSequence2 = getValue(innerSeq2Header, 'innerSequence2', '');
                     newItemDataForRow.outerSequence2 = getValue(outerSeq2Header, 'outerSequence2', '');
                     newItemDataForRow.capturedQuantity = getNumericValue(capturedQtyHeader, 'capturedQuantity', null);
                     newItemDataForRow.isTwoWayReel = getBooleanValue(isTwoWayReelHeader, 'isTwoWayReel', false);
                     newItemDataForRow.isTwoWayReel = newItemDataForRow.isReel && newItemDataForRow.isTwoWayReel;

                     // Preserve existing count state by default
                     newItemDataForRow.counted = currentItemData.counted ?? null;
                     newItemDataForRow.isUncounted = currentItemData.isUncounted ?? true;
                     newItemDataForRow.calculatedFootage = currentItemData.calculatedFootage ?? null;
                     newItemDataForRow.lastCountTimestamp = currentItemData.lastCountTimestamp ?? null;

                     // Reel cleanup
                      if (!newItemDataForRow.isReel) { /* Clear reel fields */ }

                      // --- Determine Count based on Context ---
                     let countSource = "preserved";
                     const nowTimestamp = new Date().toISOString();
                     if (importContext === 'update') {
                         if (newItemDataForRow.isReel && newItemDataForRow.footageFactor) { /* Seq calc */ }
                         if (countSource !== "csv_sequences_update") { /* Count col check */ }
                     }

                     // --- Handle Flags based on Context ---
                     newItemDataForRow.toCount = currentItemData.toCount ?? false;
                     newItemDataForRow.currentRecountBatchId = currentItemData.currentRecountBatchId ?? null;

                     if (importContext === 'new_count') { /* Set flags */
                          if (!newItemDataForRow.toCount) itemsMarkedToCount++;
                          newItemDataForRow.toCount = true; newItemDataForRow.counted = null; newItemDataForRow.isUncounted = true; newItemDataForRow.currentRecountBatchId = null;
                     } else if (importContext === 'recount') { /* Set flags */
                          itemsAddedToRecount++;
                          newItemDataForRow.currentRecountBatchId = recountBatchId; newItemDataForRow.counted = null; newItemDataForRow.isUncounted = true; newItemDataForRow.toCount = false;
                     } else { /* update context */
                          if (countSource === 'csv_sequences_update' || countSource === 'csv_count_update') { /* Clear flags */ }
                     }

                    // --- Apply defaults and update map ---
                    const finalItemDataArray = applyDataDefaults([newItemDataForRow]);
                     if (finalItemDataArray && finalItemDataArray.length > 0) {
                         processedItemsMap.set(itemId, finalItemDataArray[0]);
                     } else { /* Handle error */ skippedCount++; skusInThisImport.delete(uniqueKey); }

                }); // End forEach row


                // --- Construct the NEW database.inventory array ---
                let finalInventory = Array.from(processedItemsMap.values());
                let finalAddedCount = 0;
                let finalUpdatedCount = 0;

                // --- Final Step for New Count Cycle: Set 'toCount' flags ---
                if (importContext === 'new_count') {
                    let itemsMarkedNotToCount = 0;
                    finalInventory = finalInventory.map(item => {
                         // ... (logic as before) ...
                         const uniqueKey = item.isReel ? `reel-${item.reelNumber}` : `sku-${item.SKU}|loc-${item.location.toLowerCase()}`;
                         if (!skusInThisImport.has(uniqueKey)) { if (item.toCount) itemsMarkedNotToCount++; item.toCount = false; }
                         if (database.inventory.some(orig => orig.itemId === item.itemId)) { finalUpdatedCount++; } else { finalAddedCount++; }
                         return item;
                    });
                     console.log(`New Count Cycle Import: Marked ${itemsMarkedNotToCount} existing items as NOT 'toCount'.`);
                } else {
                     finalInventory.forEach(item => { if (database.inventory.some(orig => orig.itemId === item.itemId)) { finalUpdatedCount++; } else { finalAddedCount++; } });
                }

                 // --- Assign the newly constructed array to the global state ---
                 database.inventory = finalInventory;
                 console.log(`In-memory database.inventory updated. Size: ${database.inventory.length}`);


                // --- Save all changes to DB ---
                 if (finalAddedCount > 0 || finalUpdatedCount > 0 || (importContext === 'new_count')) {
                     try { await DB.saveInventory(database.inventory); }
                     catch (saveError) { throw new Error(`Failed to save changes: ${saveError.message}`); }
                 }


                // --- Log Import Transaction ---
                // ... (logging logic as before) ...


                // --- Refresh UI ---
                console.log("Applying filters after inventory update...");
                applyCurrentFilters();
                updateSummaryCards();


                // --- User Feedback ---
                 // ... (feedback logic as before) ...
                 let message = `Import complete (Context: ${importContext})!`;
                 message += `\nAdded: ${finalAddedCount}\nUpdated: ${finalUpdatedCount}\nSkipped: ${skippedCount}`;
                 // ... rest of message ...
                 alert(message);


            } catch (processingError) {
                 console.error("Error processing imported CSV data:", processingError);
                 alert(`Error processing CSV data: ${processingError.message}`);
            }

        } catch (error) {
            console.error('Error processing CSV:', error);
            alert('Error importing CSV: ' + error.message);
        } finally {
            if (input.parentNode) { input.parentNode.removeChild(input); }
        }
    }; // end input.onchange

    document.body.appendChild(input);
    input.click();
}
// Helper to read file content as text (unchanged)
function readFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target.result);
        reader.onerror = (event) => reject(new Error(`File could not be read: ${event.target.error}`));
        reader.readAsText(file);
    });
}  
  
  // --- Exports ---
  function exportCSV(data) {
      try {
          if (!data || data.length === 0) {
              alert("No inventory data to export.");
              return;
          }
  
          // Define headers explicitly including new fields
          const headers = [
              "itemId", // Unique persistent ID
              "SKU", "Description", "location",
              "counted", "isUncounted", "capturedQuantity", // Count related
              "isActive", "isReel", "isTwoWayReel", // Status & Type
              "footageFactor", "innerSequence", "outerSequence", // Seq 1
              "innerSequence2", "outerSequence2", // Seq 2
              "calculatedFootage",
              "notes", "lastCountTimestamp" // Metadata
          ];
  
          const csv = Papa.unparse({
              fields: headers,
              data: data.map(item => headers.map(header => item[header] ?? '')) // Use '' for null/undefined
          }, {
              header: true,
              newline: "\r\n"
          });
  
          const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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
          if (typeof jspdf === 'undefined' || typeof jspdf.jsPDF === 'undefined') throw new Error("jsPDF library not found.");
          if (typeof jspdf.jsPDF.API?.autoTable !== 'function') throw new Error("jsPDF AutoTable plugin not found.");
  
          // Filter data based on current filters for the PDF export? Or export all?
          // Let's export based on the *currently displayed* filtered data (currentInventory)
          const dataToExport = currentInventory; // Or use 'data' (all inventory) if preferred
  
          if (!dataToExport || dataToExport.length === 0) {
              alert("No inventory data matching current filters to export.");
              return;
          }
  
          const { jsPDF } = jspdf;
          const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
          const timestamp = new Date().toLocaleString();
          const user = getUserIdentifier();
          const filterDesc = `Filters: Location="${currentFilters.location || 'Any'}", Status="${currentFilters.status}"`;
  
          // Define columns - adjust based on available space and importance
          const columns = [
              { header: 'SKU', dataKey: 'SKU' },
              { header: 'Description', dataKey: 'Description' },
              { header: 'Location', dataKey: 'location' },
              { header: 'Qty', dataKey: 'counted' },
               { header: 'Status', dataKey: 'status' }, // Combined status
               { header: 'Notes', dataKey: 'notes' }, // Add notes
              // Optional Reel Data (might make it too wide)
               //{ header: 'Factor', dataKey: 'footageFactor' },
               //{ header: 'Seq1', dataKey: 'seq1' },
               //{ header: 'Seq2', dataKey: 'seq2' },
               //{ header: 'Calc Ft', dataKey: 'calculatedFootage' },
          ];
  
          // Prepare rows
          const rows = dataToExport.map(item => {
              let status = item.isActive ? (item.isUncounted ? 'Uncounted' : 'Counted') : 'Inactive';
              let displayQty = item.counted ?? (item.isUncounted ? '---' : '0'); // Show '---' for uncounted null
               if (item.calculatedFootage !== null) displayQty = `${item.calculatedFootage.toFixed(2)} ft`;
  
              return {
                  SKU: item.SKU ?? '',
                  Description: item.Description ?? '',
                  location: item.location ?? '',
                  counted: displayQty,
                  status: status,
                  notes: item.notes ?? '', // Include notes
                  // Optional Reel Data
                  //footageFactor: item.footageFactor ?? '',
                  //seq1: `${item.innerSequence ?? ''}-${item.outerSequence ?? ''}`,
                  //seq2: item.isTwoWayReel ? `${item.innerSequence2 ?? ''}-${item.outerSequence2 ?? ''}` : '',
                  //calculatedFootage: item.calculatedFootage !== null ? item.calculatedFootage.toFixed(2) : '',
              };
          });
  
          // Add title and metadata
          doc.setFontSize(16);
          doc.text("Telecom Inventory Report", 40, 40);
          doc.setFontSize(10);
          doc.text(`Generated: ${timestamp} by ${user}`, 40, 55);
          doc.text(filterDesc, doc.internal.pageSize.getWidth() - 40, 55, { align: 'right'});
  
  
          // Generate table
          doc.autoTable({
              columns: columns,
              body: rows,
              startY: 70,
              theme: 'grid',
              headStyles: { fillColor: [44, 62, 80] },
              styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' }, // Use linebreak for overflow
              columnStyles: {
                  SKU: { cellWidth: 70 },
                  Description: { cellWidth: 180 },
                  location: { cellWidth: 80 },
                  counted: { cellWidth: 50, halign: 'right' },
                   status: { cellWidth: 50, halign: 'center' },
                   notes: { cellWidth: 'auto' }, // Let notes take remaining space
                  // Optional Reel Data widths
              },
               didParseCell: function (data) {
                  // Truncate notes cell if necessary? AutoTable's linebreak should handle it.
                  // if (data.column.dataKey === 'notes' && data.cell.raw && data.cell.raw.length > 100) {
                  //     data.cell.text = data.cell.raw.substring(0, 97) + '...';
                  // }
              },
              didDrawPage: function (data) {
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

  // MODIFIED: Now triggers a specific import process
// MODIFIED: Now triggers a specific import process with the CORRECT context string
function startNewCount() {
    if (confirm("This action requires importing a CSV file containing the SKUs for the NEW count cycle.\n\n- Items in the CSV will be marked 'To Count'.\n- Existing items NOT in the CSV will be hidden.\n- Reel sequence data in THIS import will be treated as historical (not used for quantity).\n\nProceed to select CSV file?")) {
        console.log("Starting new count cycle: Initiating specific CSV import with 'new_count' context.");
        // Trigger the import dialog, passing the CORRECT string context
        showImportDialog('new_count'); // <-- FIX: Pass the string 'new_count'
    } else {
        console.log("Start new count cycle cancelled by user.");
    }
}
  // Modify finalizeInventory in appLogic.js
  // Implement the export prompt and changed deactivation logic.
  // Helper function to show export options (could be a modal later)
  async function showExportOptionsDialog() {
    return new Promise((resolve) => {
        // Simple prompt for now, replace with a modal for better UX
        const choice = prompt("Export before finalizing?\nOptions:\n1. CSV Only\n2. PDF Only\n3. Both CSV and PDF\n4. Cancel Finalization\n\nEnter number (1-4):", "3");

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
                    console.log("Initiating CSV export...");
                    exportCSV(database.inventory); // Export ALL data before finalization changes
                }
                if (exportPDFFlag) {
                     console.log("Initiating PDF export (based on current filters)...");
                     // Note: PDF Export uses 'currentInventory' which is filtered by toCount=true.
                     // If you want PDF of *all* items, pass database.inventory instead. Let's stick to filtered for now.
                     exportPDF(currentInventory);
                }
                resolve({ proceed: true }); // Resolve indicating proceed
             } catch (exportError) {
                 console.error("Export failed during finalization prompt:", exportError);
                 alert(`Export failed: ${exportError.message}\n\nFinalization cancelled.`);
                 resolve({ proceed: false }); // Resolve indicating cancel due to error
             }
        } else {
            console.log("Finalization cancelled by user at export prompt.");
            resolve({ proceed: false }); // Resolve indicating cancel
        }
    });
}


async function finalizeInventory() {
    // 1. Prompt for Export first
    const exportResult = await showExportOptionsDialog();

    if (!exportResult || !exportResult.proceed) {
        return; // Stop if user cancelled or export failed
    }

    // 2. Confirm Finalization
    if (confirm("FINAL WARNING:\n\nThis action will:\n- Mark ACTIVE REELS with zero or null quantity as INACTIVE.\n- Clear the 'To Count' flag for ALL items, hiding them until the next cycle.\n\nThis cannot be easily undone.\n\nAre you sure you want to finalize this inventory count?")) {
        const finalizeTimestamp = new Date().toISOString();
        let deactivatedReelCount = 0;
        let toCountClearedCount = 0;

        database.inventory.forEach(item => {
            // --- MODIFIED: Deactivate only ACTIVE REELS with zero/null quantity ---
            if (item.isActive && item.isReel && (item.counted === null || item.counted === 0)) {
                item.isActive = false;
                item.lastCountTimestamp = finalizeTimestamp; // Record timestamp of status change
                deactivatedReelCount++;
                logTransaction({
                    type: 'status_change',
                    SKU: item.SKU,
                    itemId: item.itemId,
                    details: {
                        newStatus: false, // Inactive
                        reason: `Finalized REEL with ${item.counted === null ? 'null' : 'zero'} quantity`
                    }
                });
            }

            // --- NEW: Clear 'toCount' flag for ALL items ---
             if (item.toCount) {
                 item.toCount = false;
                 toCountClearedCount++;
             }
        });

        logTransaction({
            type: 'inventory_finalized',
            details: {
                deactivatedReelCount: deactivatedReelCount,
                toCountClearedCount: toCountClearedCount
            }
        });
        console.log(`Inventory finalized. ${deactivatedReelCount} reels marked as inactive. ${toCountClearedCount} items had 'toCount' flag cleared.`);

        // Autosave changes
        try {
           await autoSave();
        } catch(e) {
            console.error("Autosave failed after finalizing inventory:", e);
            alert("Finalization logic applied, but failed to save changes. Please check console and maybe export manually again.");
            // Don't proceed with UI updates if save failed? Or proceed cautiously? Let's proceed for now.
        }


        // Re-filter (should now show nothing as toCount is false) and update UI
        applyCurrentFilters();
        updateSummaryCards();
        alert(`Inventory finalized.\n- ${deactivatedReelCount} reels marked as inactive.\n- ${toCountClearedCount} items cleared from the current count view.\nReady for next cycle.`);

    } else {
        console.log("Inventory finalization cancelled by user.");
    }
}
  
  
  // --- END OF FILE appLogic.js ---
