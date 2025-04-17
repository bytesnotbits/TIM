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
            const searchInput = document.getElementById('searchInput');
            if (searchInput) {
                searchInput.addEventListener('input', debounce(wrapHandler(() => {
                    // No need to manually call applyCurrentFilters here if debounce triggers it
                    applyCurrentFilters(); // The handler now reads the search term
                }, 'search input'), 300)); // Debounce for 300ms
            }
            
            // Add debounce function (place it somewhere accessible, e.g., near helpers)
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
        }
  
          // User Identifier
          document.getElementById('userIdentifierInput')?.addEventListener('input', (event) => {
              updateUserIdentifier(event.target.value);
          });
  
          // Quick Actions & Header Buttons
          document.getElementById('start-new-count-btn')?.addEventListener('click', wrapAction(startNewCount, 'start new count'));
          document.getElementById('import-csv-btn')?.addEventListener('click', wrapAction(showImportDialog, 'import CSV'));
          document.getElementById('export-csv-btn')?.addEventListener('click', () => wrapAction(() => exportCSV(database.inventory), 'export CSV')());
          document.getElementById('export-pdf-btn')?.addEventListener('click', () => wrapAction(() => exportPDF(database.inventory), 'export PDF')());
          document.getElementById('finalize-inventory-btn')?.addEventListener('click', wrapAction(finalizeInventory, 'finalize inventory')); // New finalize button
  
          // Filters
          document.getElementById('apply-filters-btn')?.addEventListener('click', wrapAction(applyCurrentFilters, 'apply filters'));
          document.getElementById('clear-filters-btn')?.addEventListener('click', wrapAction(clearAllFilters, 'clear filters'));
          // Optional: Trigger apply on Enter in location input
          document.getElementById('locationFilterInput')?.addEventListener('keypress', (e) => {
              if (e.key === 'Enter') wrapAction(applyCurrentFilters, 'apply filters')();
          });
          // Optional: Trigger apply on status change
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
          // Close modal if clicking outside the content
           document.getElementById('itemHistoryModal')?.addEventListener('click', (event) => {
               if (event.target === event.currentTarget) { // Check if the click is on the background itself
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
          }
      };
  }
  
  
  // --- Event Delegation Handlers ---
  function handleInventoryListClick(event) {
      const target = event.target;
      const itemDiv = target.closest('.inventory-item');
      if (!itemDiv) return;
      const sku = itemDiv.dataset.sku;
      if (!sku) return;
  
      if (target.matches('button[data-action="flag"]')) {
          flagUncounted(sku);
      } else if (target.matches('button[data-action="view-history"]')) {
          // Trigger item-specific history modal
          showItemHistory(sku);
      }
  }
  
  function handleInventoryListChange(event) {
      const target = event.target;
      const itemDiv = target.closest('.inventory-item');
      if (!itemDiv) return;
      const sku = itemDiv.dataset.sku;
      if (!sku) return;
  
      if (target.matches('input[data-type="count-input"]:not(:disabled)')) {
          updateCount(sku, target.value);
      } else if (target.matches('input[data-sequence]')) { // Matches inner, outer, inner2, outer2
          updateSequences(sku);
      }
  }
  
  function handleInventoryListInput(event) {
      const target = event.target;
      const itemDiv = target.closest('.inventory-item');
      if (!itemDiv) return;
      const sku = itemDiv.dataset.sku;
      if (!sku) return;
  
       if (target.matches('textarea[data-type="notes-input"]')) {
          // Use a debounce mechanism if performance becomes an issue on rapid typing
          updateItemNotes(sku, target.value);
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
  
  function findInventoryItem(SKU) {
      if (SKU === null || SKU === undefined) {
          console.warn("findInventoryItem called with null or undefined SKU.");
          return null;
      }
      const searchSKU = String(SKU).trim();
       if (!searchSKU) {
          console.warn("findInventoryItem called with empty SKU.");
          return null;
      }
      // Find based on SKU which is the keyPath
      return database.inventory.find(item => String(item.SKU).trim() === searchSKU);
  }
  
  // Records the count, handles logging and saving
  function recordCount(SKU, quantity, countNotes = "") {
      try {
          const item = findInventoryItem(SKU);
          if (!item) {
              console.error(`Item with SKU ${SKU} not found for recording count.`);
              return null;
          }
           // Don't allow counting inactive items through UI interaction
          if (!item.isActive) {
               console.warn(`Attempted to count inactive item ${SKU}.`);
               // alert(`Item ${SKU} is inactive and cannot be counted.`); // Optional feedback
               return null; // Or maybe just return the item without changes? Return null to indicate no update.
          }
  
          const previousCount = item.counted;
          const previousFlag = item.isUncounted;
          const previousTimestamp = item.lastCountTimestamp;
  
          // No change if count is identical (unless notes added or state changing from uncounted)
          if (previousCount === quantity && !countNotes && previousFlag === false && previousCount !== null) {
               console.log(`Count for ${SKU} is already ${quantity}. No change recorded.`);
               return item; // No change needed
          }
  
          item.counted = quantity;
          item.isUncounted = false; // Explicitly counted
          item.lastCountTimestamp = new Date().toISOString();
          // Note: We don't automatically update item.notes here, that's separate
  
          logTransaction({
              type: 'update_count',
              SKU: item.SKU,
              itemId: item.itemId, // Log persistent ID
              details: {
                  oldValue: previousCount,
                  newValue: quantity,
                  wasUncounted: previousFlag,
                  notes: countNotes // Log notes associated with this specific count action
              }
          });
          console.log(`Recorded count for ${item.SKU}: ${previousCount} -> ${quantity}`);
  
          autoSave().catch(e => console.error("Autosave failed after recording count:", e));
  
          return item;
      } catch (error) {
          console.error(`Error in recordCount for SKU ${SKU}:`, error);
          return null;
      }
  }
  
  function flagUncounted(SKU) {
       try {
          const item = findInventoryItem(SKU);
          if (!item) { console.error(`Item ${SKU} not found for flagging.`); return; }
          if (!item.isActive) { console.warn(`Attempted to flag inactive item ${SKU}.`); return; }
          if (item.isUncounted === true && item.counted === null) { return; } // No change needed
  
          const previousState = { counted: item.counted, isUncounted: item.isUncounted };
          item.isUncounted = true;
          item.counted = null;
          item.lastCountTimestamp = new Date().toISOString();
          // Optionally clear sequences/calculated footage when flagged?
          // item.innerSequence = ''; item.outerSequence = ''; item.innerSequence2 = ''; item.outerSequence2 = ''; item.calculatedFootage = null;
  
          logTransaction({
              type: 'flag_uncounted',
              SKU: item.SKU,
              itemId: item.itemId,
              details: { previousState: previousState }
          });
          console.log(`Flagged ${item.SKU} as uncounted.`);
  
          autoSave().catch(e => console.error("Autosave failed after flagging:", e));
          applyCurrentFilters(); // Re-apply filters which triggers re-render
          updateSummaryCards();
  
       } catch (error) {
           console.error(`Error in flagUncounted for SKU ${SKU}:`, error);
           alert(`Failed to flag item ${SKU}. See console for details.`);
       }
  }
  
  // Called by event handler on count input change
  function updateCount(SKU, quantityStr) {
      const quantity = Number(quantityStr);
       if (isNaN(quantity) || quantity < 0) {
           alert("Invalid quantity entered. Please enter a non-negative number.");
           // Re-render to reset the input value visually
           const itemDiv = document.querySelector(`.inventory-item[data-sku="${SKU}"]`);
           const input = itemDiv?.querySelector('input[data-type="count-input"]');
           const item = findInventoryItem(SKU);
           if(input && item) {
              input.value = (item.counted === null || item.counted === undefined) ? '' : item.counted;
           }
           return;
       }
  
      const updatedItem = recordCount(SKU, quantity); // Use recordCount for logging/saving
  
      if (updatedItem) {
          applyCurrentFilters(); // Re-filter and render
          updateSummaryCards();
      } else {
          // Handle case where recordCount failed (already logged error)
          console.warn(`Update count for ${SKU} did not result in a saved change.`);
          applyCurrentFilters(); // Re-render to reset input if needed
      }
  }
  
  
  function calculateFootage(item, sequences) {
      try {
          if (!item || typeof item.footageFactor !== 'number' || isNaN(item.footageFactor) || item.footageFactor <= 0) {
              return null;
          }
  
          let totalFootage = 0;
          let calculationPossible = false;
  
          // First pair
          const inner1 = Number(sequences.inner1);
          const outer1 = Number(sequences.outer1);
          if (!isNaN(inner1) && !isNaN(outer1) && outer1 >= inner1 && sequences.inner1.trim() !== '' && sequences.outer1.trim() !== '') {
              totalFootage += Math.abs(outer1 - inner1); // Use abs just in case, though should be outer >= inner
              calculationPossible = true; // At least one pair is valid
          } else if (sequences.inner1.trim() !== '' || sequences.outer1.trim() !== '') {
              // Sequences entered but invalid
               console.warn(`Invalid sequence pair 1 for ${item.SKU}: Inner=${sequences.inner1}, Outer=${sequences.outer1}`);
               return null; // Invalidate calculation if any pair is entered but invalid
          }
  
  
          // Second pair (only if it's a two-way reel and sequences are present)
          if (item.isTwoWayReel) {
              const inner2 = Number(sequences.inner2);
              const outer2 = Number(sequences.outer2);
               if (!isNaN(inner2) && !isNaN(outer2) && outer2 >= inner2 && sequences.inner2.trim() !== '' && sequences.outer2.trim() !== '') {
                   totalFootage += Math.abs(outer2 - inner2); // Use abs
                   calculationPossible = true;
               } else if (sequences.inner2.trim() !== '' || sequences.outer2.trim() !== '') {
                   // Sequences entered but invalid
                   console.warn(`Invalid sequence pair 2 for ${item.SKU}: Inner=${sequences.inner2}, Outer=${sequences.outer2}`);
                   return null; // Invalidate calculation if any pair is entered but invalid
               }
          }
  
          return calculationPossible ? (totalFootage * item.footageFactor) : null;
  
      } catch (error) {
          console.error(`Error calculating footage for ${item?.SKU}:`, error);
          return null;
      }
  }
  
  // Called by event handler on sequence input change
  function updateSequences(SKU) {
      try {
          const item = findInventoryItem(SKU);
          if (!item || !item.isActive) return; // Don't update inactive or non-existent
  
          const itemDiv = document.querySelector(`.inventory-item[data-sku="${SKU}"]`);
          if (!itemDiv) return;
  
          // Gather all sequence values from the inputs
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
               item.innerSequence2 = ''; // Clear second pair if not two-way
               item.outerSequence2 = '';
          }
  
  
          const calculatedFootage = calculateFootage(item, sequenceValues);
          item.calculatedFootage = calculatedFootage; // Update model even if null
  
          // Update the main count only if calculation is valid
          if (calculatedFootage !== null) {
              const updatedItem = recordCount(SKU, calculatedFootage, "Calculated from sequences");
              if (!updatedItem) {
                   // recordCount failed (error already logged), but save sequence changes anyway
                   autoSave().catch(e => console.error("Autosave failed after failed sequence count update:", e));
              }
          } else {
              // Calculation invalid (or no sequences entered), just save the sequence changes
              // Should we clear the main count if sequences become invalid? Maybe not automatically.
               autoSave().catch(e => console.error("Autosave failed after invalid sequence calculation:", e));
          }
  
          // Re-render needed to show updated sequences, calculated footage, and potentially main count
          applyCurrentFilters(); // Re-filter and render
          updateSummaryCards();
  
      } catch (error) {
          console.error(`Error updating sequences for SKU ${SKU}:`, error);
          alert(`Failed to update sequences for ${SKU}. See console for details.`);
          applyCurrentFilters(); // Re-render to reset UI state if needed
      }
  }
  
  // Called by event handler on notes textarea input
  function updateItemNotes(SKU, notes) {
      try {
          const item = findInventoryItem(SKU);
          if (!item || !item.isActive) return;
  
          if (item.notes !== notes) {
               const oldNotes = item.notes;
               item.notes = notes;
              // Log note changes? Maybe only log significant ones? Or rely on count logs?
              // For now, let's not log every keystroke. Log when count is saved?
              // Let's log it separately for clarity.
               logTransaction({
                   type: 'update_notes',
                   SKU: item.SKU,
                   itemId: item.itemId,
                   details: {
                       oldValue: oldNotes,
                       newValue: notes
                   }
               });
              console.log(`Updated notes for ${SKU}`);
              autoSave().catch(e => console.error("Autosave failed after updating notes:", e));
              // No re-render needed just for notes usually, but maybe update timestamp? No.
          }
      } catch (error) {
           console.error(`Error updating notes for SKU ${SKU}:`, error);
           // Maybe provide visual feedback of save failure?
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
  async function showItemHistory(sku) {
      const modal = document.getElementById('itemHistoryModal');
      const title = document.getElementById('itemHistoryModalTitle');
      const body = document.getElementById('itemHistoryModalBody');
      if (!modal || !title || !body) {
          console.error("Item history modal elements not found.");
          return;
      }
  
      const item = findInventoryItem(sku);
      if (!item) {
           alert(`Item with SKU ${sku} not found.`);
           return;
      }
  
      title.textContent = `History for SKU: ${sku} (${item.Description})`;
      body.innerHTML = '<p>Loading history...</p>';
      modal.style.display = 'block'; // Show modal immediately
  
      try {
          const itemHistory = await DB.getTransactionHistoryBySKU(sku); // Use DB function
          body.innerHTML = ''; // Clear loading message
  
          if (itemHistory.length === 0) {
              body.innerHTML = '<p>No specific transaction history found for this item.</p>';
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
/* MODIFIED showImportDialog() to handle new count cycle logic, reel number duplicates, etc. */
async function showImportDialog(isNewCountCycle = false) { // Added parameter with default
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv, text/csv';
    input.style.display = 'none';

    input.onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        console.log(`Attempting to import CSV: ${file.name}${isNewCountCycle ? ' (for New Count Cycle)' : ''}`);

        try {
            const fileContent = await readFile(file).catch(readError => {
                throw new Error(`Failed to read file: ${readError.message}`);
            });

            const result = Papa.parse(fileContent, {
                header: true,
                skipEmptyLines: true,
                dynamicTyping: false,
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
                const skusInThisImport = new Set(); // Track SKUs added/updated in this import
                const processedNonReelLocations = new Set(); // Track 'sku|location' for non-reel dup check
                const processedReelNumbers = new Set(); // Track 'reelNumber' for reel dup check

                // --- Header Detection (Including new variations and reelNumber) ---
                const headers = result.meta.fields;
                const findHeader = (possibleNames) => {
                    for (const name of possibleNames) {
                        const found = headers.find(h => h && h.toLowerCase() === name.toLowerCase());
                        if (found) return found;
                    }
                    return null;
                };

                const skuHeader = findHeader(['sku', 'item', 'partnumber', 'part number']);
                const descHeader = findHeader(['description', 'desc']);
                const locHeader = findHeader(['location', 'loc']);
                const reelNumHeader = findHeader(['reelnumber', 'reel num', 'reel #', 'reel no', 'reel no.', 'reel number']); // NEW: Reel Number
                const countHeader = findHeader(['counted', 'quantity', 'qty', 'count']);
                const capturedQtyHeader = findHeader(['capturedquantity', 'expectedquantity', 'expected qty', 'captured qty']);
                const notesHeader = findHeader(['notes', 'note', 'comments']);
                const isActiveHeader = findHeader(['isactive', 'active']);
                 // Updated reel variations
                const isReelHeader = findHeader(['isreel', 'reel', 'reel #', 'reel no', 'reel no.', 'reel number']); // Can overlap with reelNumHeader, code logic handles it
                const isTwoWayReelHeader = findHeader(['istwowayreel', 'twowayreel', 'two way reel', 'two-way', '2-way', '2 way']);
                const footageFactorHeader = findHeader(['footagefactor', 'factor', 'ft factor', 'feet', 'footage', 'ft', 'reelft', 'reel ft', 'reel footage']);
                const innerSeqHeader = findHeader(['innersequence', 'inner seq', 'inner', 'in1', 'inner1', 'i1']);
                const outerSeqHeader = findHeader(['outersequence', 'outer seq', 'outer', 'ou1', 'outer1', 'o1']);
                const innerSeq2Header = findHeader(['innersequence2', 'inner seq 2', 'inner2', 'in2', 'inner2', 'i2']);
                const outerSeq2Header = findHeader(['outersequence2', 'outer seq 2', 'outer2', 'ou2', 'outer2', 'o2']);

                if (!skuHeader) {
                    throw new Error("Required header 'SKU' (or similar) not found in CSV.");
                }
                console.log("Detected Headers:", { skuHeader, descHeader, locHeader, reelNumHeader, /*... other headers ...*/ });

                // --- Process Rows ---
                parsedData.forEach((row, index) => {
                    const rowNum = index + 2; // For user feedback (1-based index + header row)
                    const sku = String(row[skuHeader] || '').trim();
                    if (!sku) {
                        console.warn(`Skipping row ${rowNum}: Missing SKU.`);
                        skippedCount++;
                        return;
                    }

                    // Determine if it's likely a reel early for duplicate check logic
                    let isLikelyReel = (isReelHeader && ['true', '1', 'yes'].includes(String(row[isReelHeader] || '').toLowerCase())) || (reelNumHeader && (row[reelNumHeader] || '').trim() !== '');

                    const location = String(row[locHeader] || '').trim().toLowerCase(); // Standardize location for check
                    const reelNumber = String(row[reelNumHeader] || '').trim(); // Get potential reel number

                    // --- Duplicate Check ---
                    if (!isLikelyReel) {
                        const nonReelKey = `${sku}|${location}`;
                        if (processedNonReelLocations.has(nonReelKey)) {
                            console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Duplicate non-reel SKU found at the same location '${location}' in this CSV file.`);
                            skippedCount++;
                            return;
                        }
                        processedNonReelLocations.add(nonReelKey);
                    } else { // It's a reel (or has a reel number specified)
                        if (!reelNumber) {
                             console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Item identified as a reel but missing a Reel Number (required header: '${reelNumHeader || 'reelnumber/etc'}') for duplicate checking.`);
                             skippedCount++;
                             return;
                        }
                        if (processedReelNumbers.has(reelNumber)) {
                             console.warn(`Skipping row ${rowNum} (SKU: ${sku}): Duplicate Reel Number '${reelNumber}' found in this CSV file.`);
                             skippedCount++;
                             return;
                        }
                        processedReelNumbers.add(reelNumber);
                    }
                    // --- End Duplicate Check ---

                    // If we reach here, the item is not a duplicate *within this file* based on the new rules
                    skusInThisImport.add(sku); // Add SKU to set for final 'toCount' flagging

                    const existingItem = findInventoryItem(sku);

                    // Helper function to check for null/undefined
                    const isSet = (value) => value !== null && value !== undefined;

                    // Get incoming description first
                    let incomingDescRaw = row[descHeader];
                    let incomingDesc = String((isSet(incomingDescRaw) ? incomingDescRaw : (existingItem && isSet(existingItem.Description) ? existingItem.Description : 'No Description'))).trim();

                    // Handle Description Change
                    if (existingItem && existingItem.Description !== incomingDesc) {
                        console.log(`Description change detected for SKU ${sku}: "${existingItem.Description}" -> "${incomingDesc}"`);
                        logTransaction({ type: 'description_change', SKU: sku, itemId: existingItem.itemId, details: { oldDescription: existingItem.Description, newDescription: incomingDesc } });
                        descChanges++;
                        existingItem.Description = incomingDesc; // Update existing item directly
                    }

                    // Inside the forEach loop, after finding existingItem and setting up isSet...
                    // --- Prepare Item Data Object (Robust Fallback Logic) ---
                    const newItemData = {}; // Start empty

                    // Helper function to safely get value: CSV -> Existing -> Default
                    const getValue = (headerName, existingProp, defaultValue) => {
                        const csvValue = row[headerName];
                        // Check if CSV value exists and is not just whitespace
                        if (isSet(csvValue) && String(csvValue).trim() !== '') {
                            // Trim only if it's a string, otherwise return the value as is (e.g., for numbers parsed later)
                            return typeof csvValue === 'string' ? csvValue.trim() : csvValue;
                        }
                        // If no valid CSV value, check existing item
                        if (existingItem && isSet(existingItem[existingProp])) {
                            return existingItem[existingProp]; // Use existing item's value
                        }
                        // Otherwise, return the default
                        return defaultValue;
                    };

                    // Helper function for boolean values (CSV -> Existing -> Default)
                    const getBooleanValue = (headerName, existingProp, defaultValue, trueStrings = ['true', '1', 'yes'], falseStrings = ['false', '0', 'no']) => {
                        const csvValueRaw = row[headerName];
                        const csvValue = isSet(csvValueRaw) ? String(csvValueRaw).toLowerCase().trim() : null;

                        if (csvValue !== null) {
                            if (trueStrings.includes(csvValue)) return true;
                            if (falseStrings.includes(csvValue)) return false;
                        }
                        // If CSV value wasn't decisive, check existing item
                        if (existingItem && typeof existingItem[existingProp] === 'boolean') {
                            return existingItem[existingProp];
                        }
                        return defaultValue;
                    };

                    // Helper function for numeric values (CSV -> Existing -> Default)
                    const getNumericValue = (headerName, existingProp, defaultValue, allowNegative = false) => {
                        let resultValue = defaultValue; // Start with default

                        const csvValueRaw = getValue(headerName, existingProp, null); // Use getValue to handle CSV/Existing priority

                        if (isSet(csvValueRaw) && String(csvValueRaw).trim() !== '') {
                             const parsedNum = Number(String(csvValueRaw).trim());
                              if (!isNaN(parsedNum) && (allowNegative || parsedNum >= 0)) {
                                 resultValue = parsedNum; // Use valid number from CSV or existing
                             } else {
                                 console.warn(`Invalid numeric value '${csvValueRaw}' for ${headerName} (SKU: ${sku}, Row: ${rowNum}). Using default: ${defaultValue}.`);
                                 // Keep the defaultValue assigned initially
                             }
                        } else {
                             // If csvValueRaw was null/empty string after checking CSV/Existing, use default
                             resultValue = defaultValue;
                        }


                        // Specific validations after determining the value
                        if (headerName === footageFactorHeader && (resultValue === null || resultValue <= 0)) {
                            return null;
                        }
                        if (headerName === capturedQtyHeader && (resultValue === null || resultValue < 0)) {
                             return null;
                        }

                        return resultValue;
                    };

                    // --- Populate newItemData using helpers ---
                    newItemData.SKU = sku;
                    newItemData.itemId = existingItem ? existingItem.itemId : DB.generateSimpleId();

                    // Description was handled earlier due to logging, just assign
                    newItemData.Description = incomingDesc; // Already potentially updated in existingItem

                    newItemData.location = getValue(locHeader, 'location', 'No Location');
                    newItemData.reelNumber = getValue(reelNumHeader, 'reelNumber', '');
                    newItemData.notes = getValue(notesHeader, 'notes', '');
                    newItemData.isActive = getBooleanValue(isActiveHeader, 'isActive', true);

                    // Determine isReel based on flag OR presence of reel number
                    let isLikelyReelFromCSV = (isReelHeader && ['true', '1', 'yes'].includes(String(row[isReelHeader] || '').toLowerCase())) || (reelNumHeader && (row[reelNumHeader] || '').trim() !== '');
                    newItemData.isReel = isLikelyReelFromCSV || (existingItem ? existingItem.isReel : false);

                    newItemData.footageFactor = getNumericValue(footageFactorHeader, 'footageFactor', null);
                    newItemData.innerSequence = getValue(innerSeqHeader, 'innerSequence', '');
                    newItemData.outerSequence = getValue(outerSeqHeader, 'outerSequence', '');
                    newItemData.innerSequence2 = getValue(innerSeq2Header, 'innerSequence2', '');
                    newItemData.outerSequence2 = getValue(outerSeq2Header, 'outerSequence2', '');
                    newItemData.capturedQuantity = getNumericValue(capturedQtyHeader, 'capturedQuantity', null);

                    // Preserve certain existing states unless overwritten by logic below
                    newItemData.counted = existingItem ? existingItem.counted : null;
                    newItemData.isUncounted = existingItem ? existingItem.isUncounted : true; // Default new items to uncounted
                    newItemData.calculatedFootage = existingItem ? existingItem.calculatedFootage : null;
                    newItemData.lastCountTimestamp = existingItem ? existingItem.lastCountTimestamp : null;
                    newItemData.toCount = existingItem ? existingItem.toCount : false; // Preserve flag or default to false

                    // Determine isTwoWayReel (depends on isReel)
                    newItemData.isTwoWayReel = getBooleanValue(isTwoWayReelHeader, 'isTwoWayReel', false);
                    newItemData.isTwoWayReel = newItemData.isReel && newItemData.isTwoWayReel; // Enforce dependency


                    // --- Apply Reel Logic Cleanup ---
                     if (!newItemData.isReel) { // Ensure non-reels don't have reel flags/data
                         newItemData.reelNumber = '';
                         newItemData.isTwoWayReel = false;
                         newItemData.footageFactor = null;
                         newItemData.innerSequence = ''; newItemData.outerSequence = '';
                         newItemData.innerSequence2 = ''; newItemData.outerSequence2 = '';
                         newItemData.calculatedFootage = null;
                     }

                    // --- Determine Current Count based on CSV (Context Aware) ---
                    let countSource = "preserved";

                    // 1. Check Sequences (if it's a reel with factor)
                    if (newItemData.isReel && newItemData.footageFactor) {
                        const hasSequences1 = newItemData.innerSequence !== '' || newItemData.outerSequence !== '';
                        const hasSequences2 = newItemData.isTwoWayReel && (newItemData.innerSequence2 !== '' || newItemData.outerSequence2 !== '');

                        if (hasSequences1 || hasSequences2) {
                            const calculated = calculateFootage(newItemData, {
                                inner1: newItemData.innerSequence, outer1: newItemData.outerSequence,
                                inner2: newItemData.innerSequence2, outer2: newItemData.outerSequence2
                            });

                            if (calculated !== null) {
                                newItemData.calculatedFootage = calculated; // Always store calculation if valid

                                // *** MODIFIED: Only update count if NOT the initial cycle import ***
                                if (!isNewCountCycle) {
                                    newItemData.counted = calculated;
                                    newItemData.isUncounted = false;
                                    newItemData.lastCountTimestamp = new Date().toISOString();
                                    countSource = "csv_sequences_update";
                                } else {
                                    // It's the initial import, sequences are historical
                                    newItemData.counted = null; // Reset count
                                    newItemData.isUncounted = true; // Mark as uncounted for the new cycle
                                    // Keep calculatedFootage as a reference maybe? Or clear it? Let's keep it for now.
                                    countSource = "csv_sequences_initial";
                                }
                            } else {
                                // Invalid sequences
                                console.warn(`Invalid sequences in CSV for reel ${sku} (Row ${rowNum}). Preserving count state or setting to uncounted.`);
                                newItemData.calculatedFootage = null; // Ensure calculated is null
                                if (isNewCountCycle) {
                                    newItemData.counted = null;
                                    newItemData.isUncounted = true;
                                } // else preserve existing count state
                                countSource = "preserved_invalid_sequences";
                            }
                        } else {
                            // No sequences provided in CSV for a reel
                             if (isNewCountCycle) {
                                 newItemData.counted = null;
                                 newItemData.isUncounted = true;
                             } // else preserve existing count state
                             countSource = "preserved_no_sequences";
                        }
                    }

                    // 2. Check explicit Count column (Only if sequences weren't used to set count *in this import*)
                    if (countSource !== "csv_sequences_update") {
                        if (countHeader && isSet(row[countHeader]) && row[countHeader] !== '') {
                            const count = Number(String(row[countHeader]).trim());
                            if (!isNaN(count) && count >= 0) {
                                // *** MODIFIED: Only update count if NOT the initial cycle import ***
                                if (!isNewCountCycle) {
                                    newItemData.counted = count;
                                    newItemData.isUncounted = false;
                                    newItemData.lastCountTimestamp = new Date().toISOString();
                                    newItemData.calculatedFootage = null; // Manual count overrides calculation
                                    countSource = "csv_count_update";
                                } else {
                                    // Initial import, count column is ignored or treated as historical
                                    newItemData.counted = null; // Reset count
                                    newItemData.isUncounted = true; // Mark as uncounted
                                    countSource = "csv_count_initial_ignored";
                                }
                            } else {
                                console.warn(`Skipping invalid count value in CSV for SKU ${sku} (Row ${rowNum}): ${row[countHeader]}.`);
                                if (isNewCountCycle && countSource !== "preserved_invalid_sequences" && countSource !== "preserved_no_sequences") {
                                     newItemData.counted = null;
                                     newItemData.isUncounted = true;
                                } // else preserve existing count state
                            }
                        } else if (isNewCountCycle && countSource !== "preserved_invalid_sequences" && countSource !== "preserved_no_sequences") {
                             // Ensure item is marked uncounted in new cycle if no sequences or count provided
                             newItemData.counted = null;
                             newItemData.isUncounted = true;
                        }
                    }


                    // --- Update or Add Item ---
                    if (existingItem) {
                        // Merge newItemData into existingItem
                        Object.assign(existingItem, newItemData);
                         // Ensure toCount is false initially before the final flagging step
                        if (!isNewCountCycle) {
                             existingItem.toCount = existingItem.toCount || false; // Preserve existing flag if not new cycle
                        } else {
                             existingItem.toCount = false; // Will be set later based on skusInThisImport
                        }
                        updatedCount++;
                    } else {
                        // Add as a completely new item
                        newItemData.toCount = false; // Will be set later based on skusInThisImport if new cycle
                        // Apply defaults one last time for any missed properties
                        const finalNewItem = applyDataDefaults([newItemData])[0];
                        database.inventory.push(finalNewItem);
                        importedCount++;
                    }
                }); // End forEach row

                // --- Final Step for New Count Cycle: Set 'toCount' flags ---
                if (isNewCountCycle) {
                    let itemsMarkedToCount = 0;
                    let itemsMarkedNotToCount = 0;
                    database.inventory.forEach(item => {
                        if (skusInThisImport.has(item.SKU)) {
                            if (!item.toCount) itemsMarkedToCount++; // Count only if changed
                            item.toCount = true;
                             // Also reset count state just in case it wasn't handled above
                             item.counted = null;
                             item.isUncounted = true;
                        } else {
                             if (item.toCount) itemsMarkedNotToCount++; // Count only if changed
                             item.toCount = false;
                        }
                    });
                    console.log(`New Count Cycle Import: Marked ${itemsMarkedToCount} items as 'toCount', ${itemsMarkedNotToCount} items as NOT 'toCount'.`);
                    logTransaction({
                        type: 'new_count_started_import', // New log type
                        details: {
                            fileName: file.name,
                            skusImported: skusInThisImport.size,
                            itemsMarkedToCount: itemsMarkedToCount,
                             // Add imported/updated/skipped counts specific to this cycle start?
                            importedCount: importedCount,
                            updatedCount: updatedCount,
                            skippedCount: skippedCount,
                        }
                    });
                } else {
                    // Log regular import transaction
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
                }


                // Save, refresh UI
                try {
                    await autoSave();
                    applyCurrentFilters(); // Re-apply filters (now respects 'toCount') and render
                    updateSummaryCards();
                } catch (uiSaveError) {
                    console.error("Error saving or updating UI after import:", uiSaveError);
                    alert("Import partially successful, but failed to save or update the display. Please refresh. Check console for details.");
                }

                // --- User Feedback ---
                let message = isNewCountCycle
                    ? `New Count Cycle Started!\nFile: ${file.name}\nSKUs Processed: ${skusInThisImport.size}\n(Items marked 'To Count' are now visible)`
                    : `Import complete!\nFile: ${file.name}\nAdded: ${importedCount}\nUpdated: ${updatedCount}\nSkipped: ${skippedCount}`;

                if (descChanges > 0 && !isNewCountCycle) message += `\n(${descChanges} description changes logged.)`;
                message += "\n(Check console for details)";

                if (isNewCountCycle || importedCount > 0 || updatedCount > 0 || descChanges > 0) {
                    alert(message);
                } else if (skippedCount > 0) {
                    alert(`Import finished. No items were added or updated. Skipped: ${skippedCount}\n(Check console for details)`);
                } else {
                    alert("Import finished. No changes detected or items added/updated based on import rules.");
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

    // Helper to read file content as text
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
  function startNewCount() {
    if (confirm("This action requires importing a CSV file containing the SKUs for the NEW count cycle.\n\n- Items in the CSV will be marked 'To Count'.\n- Existing items NOT in the CSV will be hidden until the next cycle.\n- Sequence data in THIS import will be treated as historical (not used for quantity).\n\nProceed to select CSV file?")) {
        console.log("Starting new count cycle: Initiating specific CSV import.");
        // Trigger the import dialog, passing context
        showImportDialog(true); // Pass 'true' to indicate it's for a new count cycle
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