// --- Event Listener Setup ---
// Needs access to wrapAction/wrapHandler (stateManager.js)
// Needs access to action functions (dataLogic.js, importExport.js)
// Needs access to UI functions (uiRenderer.js)
function setupEventListeners() {
    console.log("setupEventListeners: DOM should be ready. Attempting to get elements...");
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

// --- Event Handler Functions ---
// Needs applyCurrentFilters, updateFilterControlsUI (dataLogic.js)
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

// Needs flagUncounted, findInventoryItemByItemId, finalizeSingleItem (dataLogic.js)
// Needs showItemHistory (uiRenderer.js)
// Needs wrapAction (stateManager.js)
function handleInventoryListClick(event) {
    const target = event.target;
    const itemDiv = target.closest('.inventory-item');
    if (!itemDiv) return;
    const itemId = itemDiv.dataset.itemId;

    console.log("[handleInventoryListClick] Click detected on itemDiv, itemId:", itemId); 
    console.log("[handleInventoryListClick] Clicked target element:", target); 

    if (!itemId) {
        console.error("Could not find itemId on inventory item div:", itemDiv);
        return;
    }

    const applyValueToInput = (selector, value) => {
        // ... (this helper remains the same)
        const inputElement = itemDiv.querySelector(selector);
        if (inputElement && !inputElement.disabled) {
             console.log(`Applying value '${value}' to input '${selector}' for item ${itemId}`);
             inputElement.value = value;
             console.log(`Dispatching 'change' event for input '${selector}'`);
             inputElement.dispatchEvent(new Event('change', { bubbles: true }));
             return true;
        } else if (!inputElement) { console.error(`Cannot find input '${selector}' in item ${itemId}`); return false; }
          else { console.warn(`Input '${selector}' is disabled.`); return false; }
    };

    // ----- THIS IS THE PART TO UPDATE -----
    if (target.matches('button[data-action="flag-as-uncounted"]')) { // Match the latest button action
        console.log("[handleInventoryListClick] 'Flag as Uncounted' button matched.");
        if (typeof flagItemAsUncounted === 'function') { // Call the latest function name
            flagItemAsUncounted(itemId);
        } else {
            console.error("flagItemAsUncounted function not found.");
        }
    // ----- END OF UPDATE -----
    } else if (target.matches('button[data-action="view-history"]')) {
        console.log("[handleInventoryListClick] 'View History' button matched.");
        findInventoryItemByItemId(itemId).then(item => {
            const displaySku = item ? item.SKU : itemDiv.dataset.sku;
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
        console.log("[handleInventoryListClick] 'Apply Sequence' span matched.");
        const sequenceType = target.dataset.sequenceType;
        const sequenceValue = target.dataset.sequenceValue;
        if (sequenceType && sequenceValue !== undefined) {
             applyValueToInput(`input[data-sequence="${sequenceType}"]`, sequenceValue);
        } else {
            console.error("Missing sequence type or value on clicked span:", target);
        }
    } else if (target.matches('span[data-action="apply-expected-qty"]')) {
         console.log("[handleInventoryListClick] 'Apply Expected Qty' span matched.");
         const expectedValue = target.dataset.value;
         if (expectedValue !== undefined) {
             applyValueToInput('input[data-type="count-input"]', expectedValue);
         } else {
              console.error("Missing expected quantity value on clicked span:", target);
         }
    } else if (target.matches('button[data-action="finalize-item"]')) {
        console.log("[handleInventoryListClick] 'Finalize Item' button matched.");
        wrapAction(() => finalizeSingleItem(itemId), `finalize item ${itemId}`)();
    }
} // end of handleInventoryListClick

// Needs updateCount, updateSequences, updateItemNotes (dataLogic.js)
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
